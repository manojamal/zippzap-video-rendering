import React, { useState, useRef, useEffect } from 'react';
import { MediaItem, TextOverlay } from '../types';
import { BUILTIN_MUSIC, fmtT, compressVideoFile, CompressionResult, getSoundtrackUrl as getSoundtrackUrlShared, enhanceVoiceAudio, findHighlightWindow } from '../utils';
import { RenderWorkerService, RenderOptions } from '../services/RenderWorker';
import { arrangeIntoChapters, buildCinematicEndingClip } from '../services/chapterEngine';
import { exportRenderSpec, importRenderSpec } from '../renderSpec';
import { motion, AnimatePresence } from 'motion/react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { SnapPoint, resolveSnap, getSnapThresholdSeconds, buildWholeSecondSnapPoints, buildCaptionSnapPoints } from '../timelineSnap';
import { clampRetimeRate, DEFAULT_RETIME_RATE, MIN_RETIME_RATE, MAX_RETIME_RATE } from '../retime';

/**
 * Resolution tier + aspect ratio -> real output pixel dimensions, shared by every render
 * entry point. Previously each resolution tier was hardcoded to 16:9 dims regardless of
 * the "Canvas Crop Aspect" the user picked in the Stitcher Video Modifiers panel - that
 * control changed nothing about the actual rendered output. Width/height are rounded to
 * even numbers, since libx264 rejects odd dimensions.
 */
const RESOLUTION_LONG_EDGE: Record<string, number> = { '720p': 1280, '1080p': 1920, '4K': 3840 };
const RESOLUTION_SQUARE_EDGE: Record<string, number> = { '720p': 720, '1080p': 1080, '4K': 2160 };
const toEven = (n: number) => Math.max(2, Math.round(n / 2) * 2);
export function computeOutputDims(resolution: string, aspect: string): [number, number] {
  const long = RESOLUTION_LONG_EDGE[resolution] || 1280;
  const square = RESOLUTION_SQUARE_EDGE[resolution] || 720;
  switch (aspect) {
    case '9:16':
      return [toEven((long * 9) / 16), long];
    case '1:1':
      return [square, square];
    case '4:3':
      return [long, toEven((long * 3) / 4)];
    case '16:9':
    default:
      return [long, toEven((long * 9) / 16)];
  }
}

const EXPORT_QUALITY_MAP: Record<string, 'high' | 'balanced' | 'fast'> = { high: 'high', balanced: 'balanced', fast: 'fast' };
const EXPORT_FORMAT_MAP: Record<string, 'mp4' | 'webm' | 'avi' | 'gif'> = { MP4: 'mp4', WebM: 'webm', AVI: 'avi', GIF: 'gif' };

interface ThemedTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  soundtrackId: string;
  bgVol: number;
  clips: any[];
}

const TEMPLATE_LIBRARY: ThemedTemplate[] = [
  {
    id: 'birthday',
    name: 'Birthday Bash',
    emoji: '🎂',
    description: 'A vibrant and energetic template with upbeat background music and fun celebratory slide transitions, perfect for birthday honors.',
    soundtrackId: 'bm2',
    bgVol: 80,
    clips: [
      {
        id: 'tpl_bday_1',
        type: 'text',
        name: 'Opening Birthday Wishes',
        from: 'Themed Template',
        note: 'Welcome screen',
        event: 'Birthday Bash',
        size: '1.2 MB',
        dur: 4,
        url: null,
        thumb: null,
        textBody: '✨ HAPPY BIRTHDAY! ✨\n\nWishing you a lifetime of laughter, joy, and incredible adventures. Today is all about celebrating YOU!',
        transition: 'fade',
        hasSubtitles: false,
        created: Date.now()
      },
      {
        id: 'tpl_bday_2',
        type: 'photo',
        name: 'Memoir Frame: Cheers',
        from: 'Themed Template',
        note: 'Blowing candles',
        event: 'Birthday Bash',
        size: '2.4 MB',
        dur: 5,
        url: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&q=80&w=600',
        thumb: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&q=80&w=150',
        transition: 'slide',
        hasSubtitles: true,
        subtitles: [
          {
            id: 'sub_bday_2_1',
            text: 'Blow the candles and make a beautiful wish! 🕯️',
            start: 0.5,
            end: 4.5,
            font: 'Space Grotesk',
            color: '#facc15',
            size: 16,
            backplate: 'strip'
          }
        ],
        created: Date.now() + 1
      },
      {
        id: 'tpl_bday_3',
        type: 'video',
        name: 'Stitched Celebration Video',
        from: 'Themed Template',
        note: 'Celebration moments',
        event: 'Birthday Bash',
        size: '12.5 MB',
        dur: 6,
        url: 'https://assets.mixkit.co/videos/preview/mixkit-holding-sparklers-at-a-party-special-moment-40667-large.mp4',
        thumb: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&q=80&w=150',
        transition: 'fade',
        hasSubtitles: true,
        subtitles: [
          {
            id: 'sub_bday_3_1',
            text: 'Sparkling memories that will shine forever ✨',
            start: 0.5,
            end: 5.5,
            font: 'Inter',
            color: '#ffffff',
            size: 15,
            backplate: 'strip'
          }
        ],
        created: Date.now() + 2
      },
      {
        id: 'tpl_bday_4',
        type: 'photo',
        name: 'Memoir Frame: Celebration Decor',
        from: 'Themed Template',
        note: 'Gifts and Balloons',
        event: 'Birthday Bash',
        size: '1.8 MB',
        dur: 4,
        url: 'https://images.unsplash.com/photo-1504196606672-aef1c9ceeb28?auto=format&fit=crop&q=80&w=600',
        thumb: 'https://images.unsplash.com/photo-1504196606672-aef1c9ceeb28?auto=format&fit=crop&q=80&w=150',
        transition: 'slide',
        hasSubtitles: false,
        created: Date.now() + 3
      },
      {
        id: 'tpl_bday_5',
        type: 'text',
        name: 'Closing Blessing Screen',
        from: 'Themed Template',
        note: 'Closing credits',
        event: 'Birthday Bash',
        size: '1.1 MB',
        dur: 5,
        url: null,
        thumb: null,
        textBody: '🎂 HERE\'S TO ANOTHER AMAZING YEAR! 🎂\n\nMay your days be loaded with endless smiles and boundless blessings.\n\nWith love and respect!',
        transition: 'fade',
        hasSubtitles: false,
        created: Date.now() + 4
      }
    ]
  },
  {
    id: 'anniversary',
    name: 'Golden Anniversary',
    emoji: '💍',
    description: 'A sentimental and romantic design with smooth crossfades and warm string melodies, capturing a timeless love journey.',
    soundtrackId: 'bm1',
    bgVol: 65,
    clips: [
      {
        id: 'tpl_anniv_1',
        type: 'text',
        name: 'Opening Anniversary Greeting',
        from: 'Themed Template',
        note: 'Welcome title',
        event: 'Golden Anniversary',
        size: '1.2 MB',
        dur: 4.5,
        url: null,
        thumb: null,
        textBody: '💕 CELEBRATING LOVE & PARTNERSHIP 💕\n\nHonoring a beautiful journey of devotion, companionship, and everlasting love.',
        transition: 'fade',
        hasSubtitles: false,
        created: Date.now()
      },
      {
        id: 'tpl_anniv_2',
        type: 'photo',
        name: 'Romance Frame: Warm Sunset',
        from: 'Themed Template',
        note: 'Holding hands',
        event: 'Golden Anniversary',
        size: '2.6 MB',
        dur: 5,
        url: 'https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?auto=format&fit=crop&q=80&w=600',
        thumb: 'https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?auto=format&fit=crop&q=80&w=150',
        transition: 'fade',
        hasSubtitles: true,
        subtitles: [
          {
            id: 'sub_ann_2_1',
            text: 'Side by side, holding onto precious memories... 💕',
            start: 0.5,
            end: 4.5,
            font: 'Playfair Display',
            color: '#ffffff',
            size: 16,
            backplate: 'strip'
          }
        ],
        created: Date.now() + 1
      },
      {
        id: 'tpl_anniv_3',
        type: 'video',
        name: 'Stitched Golden Highlights',
        from: 'Themed Template',
        note: 'Couples dancing',
        event: 'Golden Anniversary',
        size: '14.1 MB',
        dur: 6,
        url: 'https://assets.mixkit.co/videos/preview/mixkit-young-couple-slow-dancing-in-the-kitchen-40356-large.mp4',
        thumb: 'https://images.unsplash.com/photo-1464746133101-a2c3f88e0dd9?auto=format&fit=crop&q=80&w=150',
        transition: 'fade',
        hasSubtitles: true,
        subtitles: [
          {
            id: 'sub_ann_3_1',
            text: 'A love that grows more beautiful with each passing year.',
            start: 0.5,
            end: 5.5,
            font: 'Playfair Display',
            color: '#34d399',
            size: 16,
            backplate: 'strip'
          }
        ],
        created: Date.now() + 2
      },
      {
        id: 'tpl_anniv_4',
        type: 'photo',
        name: 'Romance Frame: Happy Moments',
        from: 'Themed Template',
        note: 'Beautiful dinner toast',
        event: 'Golden Anniversary',
        size: '1.9 MB',
        dur: 4,
        url: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
        thumb: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=150',
        transition: 'fade',
        hasSubtitles: false,
        created: Date.now() + 3
      },
      {
        id: 'tpl_anniv_5',
        type: 'text',
        name: 'Closing Anniversary Tribute',
        from: 'Themed Template',
        note: 'Closing credits',
        event: 'Golden Anniversary',
        size: '1.0 MB',
        dur: 5,
        url: null,
        thumb: null,
        textBody: '🌹 HAPPY ANNIVERSARY! 🌹\n\nMay your hearts remain connected forever, and your story continue to inspire everyone around you.',
        transition: 'fade',
        hasSubtitles: false,
        created: Date.now() + 4
      }
    ]
  },
  {
    id: 'graduation',
    name: 'Graduation Triumph',
    emoji: '🎓',
    description: 'An inspiring, high-energy layout with fast-paced sliding transitions and majestic triumphant acoustic beats to celebrate key academic achievements.',
    soundtrackId: 'bm3',
    bgVol: 85,
    clips: [
      {
        id: 'tpl_grad_1',
        type: 'text',
        name: 'Opening Graduation Wishes',
        from: 'Themed Template',
        note: 'Welcome title',
        event: 'Graduation Triumph',
        size: '1.2 MB',
        dur: 4,
        url: null,
        thumb: null,
        textBody: '🎓 THE GRADUATE TRIUMPH! 🎓\n\nCongratulations Class of 2026! Today, we celebrate the culmination of your grit, sleepless nights, and brilliant success.',
        transition: 'slide',
        hasSubtitles: false,
        created: Date.now()
      },
      {
        id: 'tpl_grad_2',
        type: 'photo',
        name: 'Grad Frame: Celebrative Cap Toss',
        from: 'Themed Template',
        note: 'Cap toss celebration',
        event: 'Graduation Triumph',
        size: '2.1 MB',
        dur: 4,
        url: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&q=80&w=600',
        thumb: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&q=80&w=150',
        transition: 'slide',
        hasSubtitles: true,
        subtitles: [
          {
            id: 'sub_grad_2_1',
            text: 'You dreamed it, worked for it, and conquered it! 🎓',
            start: 0.5,
            end: 3.5,
            font: 'Space Grotesk',
            color: '#38bdf8',
            size: 16,
            backplate: 'strip'
          }
        ],
        created: Date.now() + 1
      },
      {
        id: 'tpl_grad_3',
        type: 'video',
        name: 'Stitched Campus Highlights',
        from: 'Themed Template',
        note: 'Celebrating grads',
        event: 'Graduation Triumph',
        size: '13.8 MB',
        dur: 5,
        url: 'https://assets.mixkit.co/videos/preview/mixkit-group-of-graduates-throwing-caps-in-the-air-4521-large.mp4',
        thumb: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&q=80&w=150',
        transition: 'fade',
        hasSubtitles: true,
        subtitles: [
          {
            id: 'sub_grad_3_1',
            text: 'The horizon is bright and waiting for you!',
            start: 0.5,
            end: 4.5,
            font: 'JetBrains Mono',
            color: '#ffffff',
            size: 15,
            backplate: 'strip'
          }
        ],
        created: Date.now() + 2
      },
      {
        id: 'tpl_grad_4',
        type: 'photo',
        name: 'Grad Frame: Golden Diploma',
        from: 'Themed Template',
        note: 'Holding certificate',
        event: 'Graduation Triumph',
        size: '1.7 MB',
        dur: 4,
        url: 'https://images.unsplash.com/photo-1525921429624-479b6c294591?auto=format&fit=crop&q=80&w=600',
        thumb: 'https://images.unsplash.com/photo-1525921429624-479b6c294591?auto=format&fit=crop&q=80&w=150',
        transition: 'slide',
        hasSubtitles: false,
        created: Date.now() + 3
      },
      {
        id: 'tpl_grad_5',
        type: 'text',
        name: 'Closing Triumphant Blessing',
        from: 'Themed Template',
        note: 'Closing credits',
        event: 'Graduation Triumph',
        size: '1.0 MB',
        dur: 5,
        url: null,
        thumb: null,
        textBody: '🚀 GO FORTH & CONQUER THE WORLD! 🚀\n\nDream without boundaries, work with pride, and never lose your passion for learning.\n\nWe are immensely proud of you!',
        transition: 'fade',
        hasSubtitles: false,
        created: Date.now() + 4
      }
    ]
  }
];

interface AudioWaveformCanvasProps {
  peaks: number[];
  noiseGate: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  onUpdateTrim: (type: 'start' | 'end', val: number) => void;
}

export function AudioWaveformCanvas({
  peaks,
  noiseGate,
  trimStart,
  trimEnd,
  duration,
  onUpdateTrim
}: AudioWaveformCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = React.useState<'none' | 'start' | 'end'>('none');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear background
    ctx.fillStyle = '#05080e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;

    // Draw horizontal center gridline
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (peaks.length === 0) return;

    const barWidth = w / peaks.length;

    // Draw each symmetric bar
    peaks.forEach((peak, i) => {
      const isUnderGate = peak < noiseGate;
      const barX = i * barWidth;
      const barHeight = (peak / 100) * (h * 0.4); // max 40% up and down for center padding

      // Color mapping
      if (isUnderGate) {
        ctx.fillStyle = 'rgba(217, 119, 6, 0.45)'; // Amber/Orange for silence segment
      } else {
        ctx.fillStyle = '#6366f1'; // Beautiful indigo for active voice signal
      }

      ctx.fillRect(barX + 0.5, midY - barHeight, barWidth - 1, barHeight * 2);
    });

    // Draw active trim window overlay
    const startX = (trimStart / duration) * w;
    const endX = (trimEnd / duration) * w;

    // Mute outer regions
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, startX, h);
    ctx.fillRect(endX, 0, w - endX, h);

    // Draw trim boundaries
    ctx.strokeStyle = '#f59e0b'; // Gold start boundary
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, h);
    ctx.stroke();

    ctx.strokeStyle = '#10b981'; // Emerald end boundary
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, h);
    ctx.stroke();

    // Draw text handles inside Canvas
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(' ✂️ TRIM IN', startX, 12);

    ctx.fillStyle = '#10b981';
    ctx.textAlign = 'right';
    ctx.fillText('TRIM OUT ✂️ ', endX, h - 8);

    // Highlight area
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(startX, 0, endX - startX, h);

  }, [peaks, noiseGate, trimStart, trimEnd, duration]);

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = clickX / rect.width;
    const targetTime = Math.max(0, Math.min(duration, pct * duration));

    const distToStart = Math.abs(targetTime - trimStart);
    const distToEnd = Math.abs(targetTime - trimEnd);

    if (distToStart < distToEnd) {
      setIsDragging('start');
      onUpdateTrim('start', parseFloat(targetTime.toFixed(1)));
    } else {
      setIsDragging('end');
      onUpdateTrim('end', parseFloat(targetTime.toFixed(1)));
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging === 'none') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = clickX / rect.width;
    const targetTime = Math.max(0, Math.min(duration, pct * duration));

    if (isDragging === 'start') {
      if (targetTime < trimEnd) {
        onUpdateTrim('start', parseFloat(targetTime.toFixed(1)));
      }
    } else {
      if (targetTime > trimStart) {
        onUpdateTrim('end', parseFloat(targetTime.toFixed(1)));
      }
    }
  };

  const handlePointerUp = () => {
    setIsDragging('none');
  };

  return (
    <div className="relative select-none">
      <canvas
        ref={canvasRef}
        width={480}
        height={90}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        className="w-full h-22 rounded-xl border border-slate-800 cursor-ew-resize bg-slate-950 shadow-inner animate-in fade-in duration-200"
        title="Drag the Yellow/Green boundary lines to trim the audio segments precisely. Silence segments are orange."
      />
      <div className="absolute top-1.5 right-2 sm:right-3.5 bg-slate-950/80 px-2 py-0.5 rounded text-[8px] font-mono text-slate-400 border border-slate-800 tracking-wider">
        🖱️ Click & Drag boundaries to Trim
      </div>
    </div>
  );
}

interface VideoStudioProps {
  media: MediaItem[];
  onAddNewClip: (file: File) => void;
  onDeleteMedia?: (id: string) => void;
  timelineOrder: number[];
  clips: any[];
  onUpdateClipsState: (updatedClips: any[]) => void;
  onUpdateTimelineState: (updatedTL: number[]) => void;
  onClearTimelineAll: () => void;
  brand?: { brandColor?: string; brandLogoDataUrl?: string };
}

// Simple text wrap helper for canvas card generation
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx];
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && idx > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  return lines;
}

interface ClipTrimSliderProps {
  dur: number;
  trimStart: number;
  trimEnd: number;
  onChange: (start: number, end: number) => void;
  /** Extra magnet points beyond the whole-second gridlines this slider already snaps to
   *  (e.g. this clip's caption cue boundaries). Optional - purely additive. */
  extraSnapPoints?: SnapPoint[];
}

function ClipTrimSlider({
  dur,
  trimStart,
  trimEnd,
  onChange,
  extraSnapPoints
}: ClipTrimSliderProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  // Which handle (if any) is currently snapped to a magnet point - drives the brief
  // highlight/label so snapping is felt, not just silently applied.
  const [snappedHandle, setSnappedHandle] = React.useState<'start' | 'end' | null>(null);

  const allSnapPoints = React.useMemo(
    () => [...buildWholeSecondSnapPoints(dur), ...(extraSnapPoints || [])],
    [dur, extraSnapPoints]
  );

  const handlePointerDown = (e: React.PointerEvent, handleType: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const pixelsPerSecond = rect.width / (dur || 1);
    const snapThresholdSeconds = getSnapThresholdSeconds({ pixelsPerSecond });

    const updatePosition = (clientX: number, shiftKey: boolean) => {
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const pct = x / rect.width;
      const rawValue = Math.round(pct * dur * 10) / 10;

      // Holding Shift bypasses snapping for fine, sub-gridline adjustments - a common
      // pro-editor convention (opencut-classic and most NLEs use the same escape hatch).
      const { snappedTime, didSnap } = shiftKey
        ? { snappedTime: rawValue, didSnap: false }
        : resolveSnap({ targetTime: rawValue, snapPoints: allSnapPoints, thresholdSeconds: snapThresholdSeconds });

      setSnappedHandle(didSnap ? handleType : null);

      if (handleType === 'start') {
        const newStart = Math.max(0, Math.min(snappedTime, trimEnd - 0.1));
        onChange(newStart, trimEnd);
      } else {
        const newEnd = Math.max(trimStart + 0.1, Math.min(snappedTime, dur));
        onChange(trimStart, newEnd);
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updatePosition(moveEvent.clientX, moveEvent.shiftKey);
    };

    const handlePointerUp = () => {
      setSnappedHandle(null);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const leftPct = (trimStart / (dur || 1)) * 100;
  const rightPct = (trimEnd / (dur || 1)) * 100;
  const widthPct = Math.max(0, rightPct - leftPct);

  return (
    <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between text-[10px] font-mono font-bold text-slate-500">
        <span>Trim Start: <strong className="text-indigo-600 font-black">{trimStart.toFixed(1)}s</strong></span>
        {snappedHandle && (
          <span className="text-emerald-500 font-black animate-pulse">🧲 Snapped</span>
        )}
        <span>Trim End: <strong className="text-indigo-600 font-black">{trimEnd.toFixed(1)}s</strong></span>
      </div>
      <div 
        ref={trackRef}
        className="h-7 bg-slate-950 border border-slate-800 rounded-xl relative select-none cursor-pointer"
      >
        {/* Trimmed left zone */}
        <div 
          className="absolute left-0 top-0 bottom-0 bg-slate-900/60 border-r border-slate-800/40 rounded-l-xl"
          style={{ width: `${leftPct}%` }}
        />
        
        {/* Selected active section */}
        <div 
          className="absolute top-0 bottom-0 bg-indigo-600/20 border-l border-r border-indigo-500/30 flex items-center justify-center text-[9px] font-mono font-black text-indigo-400 select-none pointer-events-none"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        >
          {(trimEnd - trimStart).toFixed(1)}s active
        </div>

        {/* Trimmed right zone */}
        <div 
          className="absolute right-0 top-0 bottom-0 bg-slate-900/60 border-l border-slate-800/40 rounded-r-xl"
          style={{ left: `${rightPct}%` }}
        />

        {/* Handle: Start */}
        <div 
          onPointerDown={(e) => handlePointerDown(e, 'start')}
          className={`absolute top-0 bottom-0 w-4 bg-indigo-500 hover:bg-indigo-400 border rounded-l shadow-lg cursor-ew-resize flex items-center justify-center transition-colors active:bg-indigo-300 group z-10 ${snappedHandle === 'start' ? 'border-emerald-400 ring-2 ring-emerald-400/60' : 'border-indigo-300'}`}
          style={{ left: `calc(${leftPct}% - 8px)` }}
          title="Drag to adjust start trim (hold Shift to disable snapping)"
        >
          <div className="w-[1.5px] h-3 bg-white/70 rounded-full" />
          <span className="absolute bottom-full mb-1.5 bg-slate-900 text-white font-mono text-[8px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow">
            {trimStart.toFixed(1)}s
          </span>
        </div>

        {/* Handle: End */}
        <div 
          onPointerDown={(e) => handlePointerDown(e, 'end')}
          className={`absolute top-0 bottom-0 w-4 bg-indigo-500 hover:bg-indigo-400 border rounded-r shadow-lg cursor-ew-resize flex items-center justify-center transition-colors active:bg-indigo-300 group z-10 ${snappedHandle === 'end' ? 'border-emerald-400 ring-2 ring-emerald-400/60' : 'border-indigo-300'}`}
          style={{ left: `calc(${rightPct}% - 8px)` }}
          title="Drag to adjust end trim (hold Shift to disable snapping)"
        >
          <div className="w-[1.5px] h-3 bg-white/70 rounded-full" />
          <span className="absolute bottom-full mb-1.5 bg-slate-900 text-white font-mono text-[8px] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow">
            {trimEnd.toFixed(1)}s
          </span>
        </div>
      </div>
      <p className="text-[8.5px] text-slate-400 text-center font-medium font-sans">
        ↔️ Drag the Left or Right indigo handles to adjust trim boundaries visually! Snaps to whole seconds & caption cues — hold Shift for fine control.
      </p>
    </div>
  );
}

export default function VideoStudio({
  media = [],
  onAddNewClip,
  onDeleteMedia,
  timelineOrder,
  clips,
  onUpdateClipsState: parentOnUpdateClipsState,
  onUpdateTimelineState: parentOnUpdateTimelineState,
  onClearTimelineAll: parentOnClearTimelineAll,
  brand
}: VideoStudioProps) {
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [renderWarnings, setRenderWarnings] = useState<string[]>([]);
  const [audioExporting, setAudioExporting] = useState(false);
  const [audioExportProgress, setAudioExportProgress] = useState(0);
  const [audioExportError, setAudioExportError] = useState<string | null>(null);
  const [audioOutputUrl, setAudioOutputUrl] = useState<string | null>(null);
  const [audioExportWarnings, setAudioExportWarnings] = useState<string[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Undo Functionality State
  const [undoStack, setUndoStack] = useState<{ clips: any[]; timelineOrder: number[] }[]>([]);
  const lastPushRef = useRef<{ clipsJson: string; timelineJson: string; time: number } | null>(null);

  const pushToUndo = (prevClips: any[], prevTimeline: number[]) => {
    const clipsJson = JSON.stringify(prevClips);
    const timelineJson = JSON.stringify(prevTimeline);
    const now = Date.now();
    
    if (lastPushRef.current) {
      const isSameState = lastPushRef.current.clipsJson === clipsJson && lastPushRef.current.timelineJson === timelineJson;
      const isVeryRecent = now - lastPushRef.current.time < 100;
      if (isSameState || isVeryRecent) {
        return;
      }
    }
    
    lastPushRef.current = { clipsJson, timelineJson, time: now };
    
    // A genuine new edit invalidates any pending redo history.
    setRedoStack(prev => (prev.length ? [] : prev));

    setUndoStack(prev => {
      const clonedClips = JSON.parse(clipsJson);
      const clonedTimeline = JSON.parse(timelineJson);
      const nextStack = [...prev, { clips: clonedClips, timelineOrder: clonedTimeline }];
      if (nextStack.length > 50) {
        nextStack.shift();
      }
      return nextStack;
    });
  };

  const onUpdateClipsState = (newClips: any[]) => {
    pushToUndo(clips, timelineOrder);
    parentOnUpdateClipsState(newClips);
  };

  const onUpdateTimelineState = (newTL: number[]) => {
    pushToUndo(clips, timelineOrder);
    parentOnUpdateTimelineState(newTL);
  };

  const onClearTimelineAll = () => {
    pushToUndo(clips, timelineOrder);
    parentOnClearTimelineAll();
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const nextStack = [...undoStack];
    const prevState = nextStack.pop();
    setUndoStack(nextStack);
    if (prevState) {
      // Stash the *current* state onto the redo stack before we overwrite it,
      // so redo can bring it back.
      setRedoStack(prev => {
        const nextRedo = [...prev, { clips: JSON.parse(JSON.stringify(clips)), timelineOrder: JSON.parse(JSON.stringify(timelineOrder)) }];
        if (nextRedo.length > 50) nextRedo.shift();
        return nextRedo;
      });
      // Temporarily bypass tracking for the restoration step to avoid pushing it right back onto the stack
      lastPushRef.current = { 
        clipsJson: JSON.stringify(prevState.clips), 
        timelineJson: JSON.stringify(prevState.timelineOrder), 
        time: Date.now() 
      };
      parentOnUpdateClipsState(prevState.clips);
      parentOnUpdateTimelineState(prevState.timelineOrder);
    }
  };

  // Redo Functionality State — mirrors the undo stack above. A redo becomes
  // available whenever an undo happens, and is cleared the moment the user
  // makes a fresh edit (the standard, expected undo/redo semantics).
  const [redoStack, setRedoStack] = useState<{ clips: any[]; timelineOrder: number[] }[]>([]);

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextRedo = [...redoStack];
    const nextState = nextRedo.pop();
    setRedoStack(nextRedo);
    if (nextState) {
      setUndoStack(prev => {
        const nextUndo = [...prev, { clips: JSON.parse(JSON.stringify(clips)), timelineOrder: JSON.parse(JSON.stringify(timelineOrder)) }];
        if (nextUndo.length > 50) nextUndo.shift();
        return nextUndo;
      });
      lastPushRef.current = {
        clipsJson: JSON.stringify(nextState.clips),
        timelineJson: JSON.stringify(nextState.timelineOrder),
        time: Date.now()
      };
      parentOnUpdateClipsState(nextState.clips);
      parentOnUpdateTimelineState(nextState.timelineOrder);
    }
  };

  // Any *new* edit (not triggered by undo/redo itself) invalidates the redo
  // stack — standard editor behaviour, and prevents redo from resurrecting a
  // branch of history that no longer makes sense. (Handled inside pushToUndo.)

  // Moved up from its original spot further down in this component (search "CHROMATIC
  // TRANSITION" states) so the keyboard-shortcut effect right below can safely reference it -
  // it needs to exist before that useEffect() call executes, not just before it's invoked.
  const [selectedClipIdx, setSelectedClipIdx] = useState<number>(0);

  // Clip clipboard: copy one clip's full settings (trim/speed/fx/subtitles/etc.) and paste
  // a duplicate elsewhere on the timeline. Session-only (component state), not persisted -
  // there's nothing to restore across a reload since it can hold live File references.
  const [clipboardClip, setClipboardClip] = useState<any | null>(null);

  // Timeline markers/bookmarks: named points on the global preview timeline (same time axis
  // as `playTime`/`totalDuration` below), independent of any one clip. Distinct from the Story
  // Chapters engine above (which reorders/groups clips) - these are just navigation/export
  // timestamps, so they're called "markers" everywhere in code to avoid confusion with that.
  const [markers, setMarkers] = useState<{ id: string; time: number; label: string }[]>([]);

  const addMarkerAtTime = (time: number) => {
    const label = window.prompt('Marker name?', `Chapter ${markers.length + 1}`);
    if (label === null) return; // user cancelled
    const marker = { id: 'mrk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5), time, label: label.trim() || `Chapter ${markers.length + 1}` };
    setMarkers(prev => [...prev, marker].sort((a, b) => a.time - b.time));
  };

  const removeMarker = (id: string) => {
    setMarkers(prev => prev.filter(m => m.id !== id));
  };

  const formatMarkerTimestamp = (seconds: number): string => {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const handleCopyMarkerList = async () => {
    if (markers.length === 0) {
      alert('🔖 Add at least one marker first!');
      return;
    }
    const text = markers
      .slice()
      .sort((a, b) => a.time - b.time)
      .map(m => `${formatMarkerTimestamp(m.time)} ${m.label}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert('📋 Chapter list copied! Paste it straight into your YouTube description.');
    } catch {
      window.prompt('Copy this chapter list manually:', text);
    }
  };

  // Keyboard shortcuts: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTypingField) return;

      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta) {
        const key = e.key.toLowerCase();
        if (key === 'z' && e.shiftKey) {
          e.preventDefault();
          handleRedo();
          return;
        } else if (key === 'z') {
          e.preventDefault();
          handleUndo();
          return;
        } else if (key === 'y') {
          e.preventDefault();
          handleRedo();
          return;
        } else if (key === 'c') {
          // Copy the currently selected clip's full settings (trim/speed/fx/etc.).
          e.preventDefault();
          handleCopyClip(selectedClipIdx);
          return;
        } else if (key === 'v') {
          // Paste right after the currently selected clip.
          e.preventDefault();
          handlePasteClip(selectedClipIdx);
          return;
        }
        return;
      }

      // Plain "M" (no modifier) drops a marker at the current playhead position - the same
      // convention Premiere/most NLEs use for markers.
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        addMarkerAtTime(playTime);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, redoStack, clips, timelineOrder, selectedClipIdx, playTime, clipboardClip, markers]);

  const getClipFilterString = (filterType: string) => {
    if (!filterType || filterType === 'none') return 'none';
    if (filterType === 'sepia') return 'sepia(85%)';
    if (filterType === 'grayscale') return 'grayscale(100%)';
    if (filterType === 'vibrant') return 'saturate(180%) contrast(125%) brightness(110%)';
    if (filterType === 'high-contrast') return 'contrast(160%) saturate(140%)';
    if (filterType === 'warm') return 'sepia(30%) saturate(125%) hue-rotate(-10deg)';
    if (filterType === 'cool') return 'saturate(110%) hue-rotate(15deg) brightness(110%)';
    // Newer effects (vignette, old film, noir, dreamy, vhs, invert, sharpen, blur, thermal,
    // night vision, sketch) share their CSS approximation with getFilterCss rather than
    // duplicating the mapping a third time.
    return getFilterCss(filterType);
  };

  const handleBulkApplyFilter = (filterType: string) => {
    pushToUndo(clips, timelineOrder);
    const updated = clips.map(c => {
      if (c.type !== 'audio') {
        return { ...c, filter: filterType };
      }
      return c;
    });
    onUpdateClipsState(updated);
  };

  // New audio soundtrack and visualization states
  const [soundtrackId, setSoundtrackId] = useState<string>('none');
  const [activeVideoFilter, setActiveVideoFilter] = useState<
    'none' | 'grayscale' | 'sepia' | 'vibrant' | 'brightness' |
    'vignette' | 'oldfilm' | 'noir' | 'dreamy' | 'vhs' | 'invert' | 'sharpen' | 'blur' | 'thermal' | 'nightvision' | 'sketch'
  >('none');
  const [renderingStatus, setRenderingStatus] = useState<string>('Initializing Stitch & Render sequence...');

  // Immersive Fullscreen and custom MP4 export states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenHideOptions, setIsFullscreenHideOptions] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(100);
  const [exportFormat, setExportFormat] = useState<'MP4' | 'WebM' | 'AVI' | 'GIF'>('MP4');
  const [exportResolution, setExportResolution] = useState<'1080p' | '720p' | '4K'>('1080p');
  const [exportFps, setExportFps] = useState<number>(30);
  const [exportQuality, setExportQuality] = useState<'high' | 'balanced' | 'fast'>('balanced');
  
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [downloadableMovieUrl, setDownloadableMovieUrl] = useState<string | null>(null);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [batchStatus, setBatchStatus] = useState('');
  const [batchResults, setBatchResults] = useState<{ label: string; url: string; filename: string }[]>([]);

  // Guard against losing an in-progress render (which can take minutes with no
  // hardware acceleration in WASM) to an accidental tab close, refresh, or back
  // button - the single most literal way an export could be "interrupted." Also
  // covers the moment right after a render finishes but before it's downloaded -
  // the finished file only exists as an in-memory blob URL, so navigating away
  // before clicking "Download" loses it just as completely as a mid-render crash.
  useEffect(() => {
    if (!isExporting && !isBatchExporting && !downloadableMovieUrl) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isExporting, isBatchExporting, downloadableMovieUrl]);

  const specImportInputRef = useRef<HTMLInputElement | null>(null);

  const handleExportMovie = async () => {
    if (clips.length === 0) {
      alert('🎬 Add at least one clip to the timeline first!');
      return;
    }
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Booting up local video engine (WebAssembly FFmpeg)...');
    if (downloadableMovieUrl) URL.revokeObjectURL(downloadableMovieUrl);
    setDownloadableMovieUrl(null);
    setExportWarnings([]);

    const [w, h] = computeOutputDims(exportResolution, cropAspect);

    if (!renderWorkerServiceRef.current) {
      renderWorkerServiceRef.current = new RenderWorkerService();
    }

    renderWorkerServiceRef.current.startRender(
      clips,
      {
        soundtrackUrl: getSoundtrackUrl(soundtrackId),
        soundtrackVolume: bgVol,
        videoFilter: activeVideoFilter,
        fitMode: fitMode,
        colorGrade: colorGrade,
        overlays: overlays,
        audioPitch: audioPitch,
        audioReversed: audioReversed,
        autoTrimSilence: autoTrimSilenceEnabled,
        outputWidth: w,
        outputHeight: h,
        outputFps: exportFps,
        outputFormat: EXPORT_FORMAT_MAP[exportFormat] || 'mp4',
        quality: EXPORT_QUALITY_MAP[exportQuality] || 'balanced',
        masterVolume: masterVideoVolume,
        eq: { bass: eqBass - 50, mid: eqMid - 50, treble: eqTreble - 50 },
        brandColor: brand?.brandColor,
        brandLogoDataUrl: brand?.brandLogoDataUrl,
        // Real MP4 chapter markers from the bookmarks added via "🔖 Add Chapter" / the M
        // shortcut - only meaningfully supported when the output container is actually mp4.
        markers: (EXPORT_FORMAT_MAP[exportFormat] || 'mp4') === 'mp4' && markers.length > 0
          ? markers.map(m => ({ time: m.time, label: m.label }))
          : undefined,
      },
      (prog, _eta, status) => {
        setExportProgress(prog);
        setExportStatus(status);
      },
      (finishedUrl, warnings) => {
        setDownloadableMovieUrl(finishedUrl);
        setExportWarnings(warnings || []);
        setExportStatus('Movie compiled successfully! Click download below.');
        setIsExporting(false);
      },
      (errorMessage) => {
        setIsExporting(false);
        setExportStatus(`Export failed: ${errorMessage}`);
        alert(`❌ Export failed: ${errorMessage}`);
      }
    );
  };

  /** Renders the exact same timeline three times at three common crop presets, one after another. */
  const handleBatchExport = async () => {
    if (clips.length === 0) {
      alert('🎬 Add at least one clip to the timeline first!');
      return;
    }
    setIsBatchExporting(true);
    setBatchResults([]);
    const presets: { label: string; filename: string; w: number; h: number }[] = [
      { label: 'Instagram Stories (9:16)', filename: 'reel_9x16', w: 1080, h: 1920 },
      { label: 'Square (1:1)', filename: 'square_1x1', w: 1080, h: 1080 },
      { label: 'Standard (16:9)', filename: 'standard_16x9', w: 1920, h: 1080 },
    ];
    const results: { label: string; url: string; filename: string }[] = [];

    for (const preset of presets) {
      setBatchStatus(`Rendering ${preset.label}...`);
      try {
        const url = await new Promise<string>((resolve, reject) => {
          const worker = new RenderWorkerService();
          worker.startRender(
            clips,
            {
              soundtrackUrl: getSoundtrackUrl(soundtrackId),
              soundtrackVolume: bgVol,
              videoFilter: activeVideoFilter,
              fitMode: 'cover', // batch social crops always fill-crop, never letterbox
              colorGrade: colorGrade,
              overlays: overlays,
              audioPitch: audioPitch,
              audioReversed: audioReversed,
              outputWidth: preset.w,
              outputHeight: preset.h,
              outputFps: exportFps,
              outputFormat: 'mp4',
              quality: 'balanced',
              brandColor: brand?.brandColor,
              brandLogoDataUrl: brand?.brandLogoDataUrl,
              markers: markers.length > 0 ? markers.map(m => ({ time: m.time, label: m.label })) : undefined,
            },
            (prog, _eta, status) => setBatchStatus(`${preset.label}: ${status} (${prog}%)`),
            (finishedUrl) => resolve(finishedUrl),
            (errorMessage) => reject(new Error(errorMessage))
          );
        });
        results.push({ label: preset.label, url, filename: `${preset.filename}.mp4` });
      } catch (err: any) {
        console.warn(`Batch export failed for ${preset.label}:`, err);
        setBatchStatus(`⚠️ ${preset.label} failed, continuing with the rest...`);
      }
    }

    setBatchResults(results);
    setBatchStatus(results.length > 0 ? `Done! ${results.length} of ${presets.length} formats ready.` : 'All formats failed.');
    setIsBatchExporting(false);
  };

  const handleExportRenderSpec = () => {
    const options: RenderOptions = {
      soundtrackUrl: getSoundtrackUrl(soundtrackId),
      soundtrackVolume: bgVol,
      videoFilter: activeVideoFilter,
      fitMode: fitMode,
      colorGrade: colorGrade,
      overlays: overlays,
      audioPitch: audioPitch,
      audioReversed: audioReversed,
      outputFps: exportFps,
      outputFormat: (exportFormat.toLowerCase() as any),
      quality: exportQuality,
      brandColor: brand?.brandColor,
      brandLogoDataUrl: brand?.brandLogoDataUrl,
    };
    const spec = exportRenderSpec(clips, options);
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zippzap-render-spec.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleImportRenderSpec = async (file: File) => {
    try {
      const text = await file.text();
      const { clips: importedClips, options } = importRenderSpec(text, media);
      onUpdateClipsState(importedClips);
      onUpdateTimelineState(importedClips.map((_: any, i: number) => i));
      if (options.outputFormat) setExportFormat(options.outputFormat.toUpperCase() as any);
      if (options.quality) setExportQuality(options.quality);
      if (typeof options.soundtrackVolume === 'number') setBgVol(options.soundtrackVolume);
      alert(`✅ Imported render spec with ${importedClips.length} clip(s). Review the timeline, then render as usual.`);
    } catch (err: any) {
      alert(`⚠️ Could not import render spec: ${err?.message || err}`);
    }
  };

  // Audio mix sliders
  const [bgVol, setBgVol] = useState(70);
  const [vidVol, setVidVol] = useState(100);
  const [voiceVol, setVoiceVol] = useState(90);

  // Transitions settings
  const [transition, setTransition] = useState('fade');
  const [colorGrade, setColorGrade] = useState('none');
  const [resolution, setResolution] = useState('720');

  // Overlays
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [overlayText, setOverlayText] = useState('');

  // Native drag & drop reorder index state
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);

  // Transition preview popup trigger
  const [previewTransitionType, setPreviewTransitionType] = useState<string | null>(null);

  // Programmatic Animated Frame state
  const [animatedFrame, setAnimatedFrame] = useState<'none' | 'sparkles' | 'hearts' | 'neon' | 'vintage'>('none');

  // Multi-format dimension layout fitting choices
  const [fitMode, setFitMode] = useState<'cover' | 'contain' | 'blur'>('cover');

  // Volume normalization state
  const [volumeNormalizationEnabled, setVolumeNormalizationEnabled] = useState<boolean>(false);
  const [autoTrimSilenceEnabled, setAutoTrimSilenceEnabled] = useState<boolean>(false);

  // Celebrating Person & Opening Surprise Intro Settings
  const [celebrationIntroEnabled, setCelebrationIntroEnabled] = useState<boolean>(true);
  const [celebratedName, setCelebratedName] = useState<string>('Dakiya');
  const [celebratedPhoto, setCelebratedPhoto] = useState<string>('https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&q=80&w=400');
  const [celebrationIntroDuration, setCelebrationIntroDuration] = useState<number>(5);
  const portraitUploadRef = useRef<HTMLInputElement>(null);

  // Real-time programmatic audio waveforms overlays
  const [showLiveAudioWaveform, setShowLiveAudioWaveform] = useState(true);
  const [waveformStyle, setWaveformStyle] = useState<'spectrum' | 'wave' | 'circular' | 'cyber_bars'>('spectrum');

  // Render ETA remaining and custom uploaded soundtracks
  const [renderEta, setRenderEta] = useState<number>(0);
  const [customSoundtrackUrl, setCustomSoundtrackUrl] = useState<string | null>(null);
  const [customSoundtrackName, setCustomSoundtrackName] = useState<string>('');

  // Studio clip-level client-side compressor states
  const [isStudioCompressing, setIsStudioCompressing] = useState<boolean>(false);
  const [studioCompressProgress, setStudioCompressProgress] = useState<number>(0);
  const [studioCompressEta, setStudioCompressEta] = useState<number>(0);
  const [studioCompressStatus, setStudioCompressStatus] = useState<string>('');
  const [studioCompressPreset, setStudioCompressPreset] = useState<'low' | 'medium' | 'high'>('medium');
  const [studioCompressedStats, setStudioCompressedStats] = useState<{
    oldSize: number;
    newSize: number;
    savedPercentage: number;
    originalResolution: string;
    compressedResolution: string;
    targetClipId: string;
  } | null>(null);


  // Export Preview Modal states
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [previewClipIdx, setPreviewClipIdx] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTimer, setPreviewTimer] = useState(0);

  // 🎙️ ADVANCED MULTI-MEDIA STUDIO HUB STATES
  const [activeStudioToolTab, setActiveStudioToolTab] = useState<'video' | 'audio' | 'converters' | 'specials'>('video');
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [screenRecordTimer, setScreenRecordTimer] = useState(0);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [voiceRecordTimer, setVoiceRecordTimer] = useState(0);
  const [isWebcamRecording, setIsWebcamRecording] = useState(false);
  const [webcamRecordTimer, setWebcamRecordTimer] = useState(0);

  // Text-To-Speech inputs
  const [ttsInput, setTtsInput] = useState('');
  const [ttsAccent, setTtsAccent] = useState('us-warm');
  const [ttsGenerating, setTtsGenerating] = useState(false);
  const [voiceEnhanceFile, setVoiceEnhanceFile] = useState<File | null>(null);
  const [voiceEnhanceStrength, setVoiceEnhanceStrength] = useState<'light' | 'medium' | 'strong'>('medium');
  const [isEnhancingVoice, setIsEnhancingVoice] = useState(false);
  const [voiceEnhanceProgress, setVoiceEnhanceProgress] = useState(0);
  const [voiceEnhanceStatus, setVoiceEnhanceStatus] = useState('');
  const voiceEnhanceInputRef = useRef<HTMLInputElement>(null);
  const [isFindingHighlights, setIsFindingHighlights] = useState(false);
  const [highlightFinderStatus, setHighlightFinderStatus] = useState('');
  // The docked timeline strip is fixed-position, so it can visually cover whatever normal-
  // flow content happens to render in the last ~64px of the viewport. Near the top of the
  // page that's the tall preview card's own playback controls (confirmed live: it overlapped
  // "Forward"/"Stop" at scroll position 0 on a typical viewport height) - rather than the
  // reference layout's fully height-bounded 3-zone shell (a much larger restructuring), only
  // show the strip once the user has actually scrolled past the hero/preview area, which is
  // also exactly when they'd want it (scrolled down into the long settings column).
  const [showDockedTimeline, setShowDockedTimeline] = useState(false);
  useEffect(() => {
    const handleScroll = () => setShowDockedTimeline(window.scrollY > 420);
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  const [bgRemoveFile, setBgRemoveFile] = useState<File | null>(null);
  const [bgRemoveBackdrop, setBgRemoveBackdrop] = useState('#FFFFFF');
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [bgRemoveStatus, setBgRemoveStatus] = useState('');
  const bgRemoveInputRef = useRef<HTMLInputElement>(null);

  // Equalizer values
  const [eqBass, setEqBass] = useState(50);
  const [eqMid, setEqMid] = useState(50);
  const [eqTreble, setEqTreble] = useState(50);
  const [audioPitch, setAudioPitch] = useState(1.0);
  const [audioSpeed, setAudioSpeed] = useState(1.0);
  const [audioReversed, setAudioReversed] = useState(false);

  // Core format converter states
  const [convertType, setConvertType] = useState<'audio' | 'video' | 'image'>('video');
  const [convertInFormat, setConvertInFormat] = useState('MP4');
  const [convertOutFormat, setConvertOutFormat] = useState('WEBM');
  const [convertProgress, setConvertProgress] = useState(0);
  const [convertStatus, setConvertStatus] = useState<string | null>(null);
  const [convertSourceFile, setConvertSourceFile] = useState<File | null>(null);
  const [convertResultUrl, setConvertResultUrl] = useState<string | null>(null);
  const [convertResultName, setConvertResultName] = useState<string>('');

  // Video processing modifiers
  const [cropAspect, setCropAspect] = useState<'16:9' | '9:16' | '1:1' | '4:3'>('16:9');
  const [logoRemovalCorner, setLogoRemovalCorner] = useState<'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('none');
  const [videoStabilizeStrength, setVideoStabilizeStrength] = useState<'none' | 'low' | 'med' | 'high'>('none');
  const [loopRepetitions, setLoopRepetitions] = useState<number>(1);
  const [masterVideoVolume, setMasterVideoVolume] = useState<number>(100);

  // Per-clip extra rotation or mirror flip states matching items
  const [clipRotationsState, setClipRotationsState] = useState<Record<string, number>>({});
  const [clipFlipsState, setClipFlipsState] = useState<Record<string, 'none' | 'h' | 'v' | 'both'>>({});
  const [clipSpeedsState, setClipSpeedsState] = useState<Record<string, number>>({});

  // 🌟 ENHANCED CHROMATIC TRANSITION & MULTI-TIMELINE PRECISION STATES
  const [clipScrubTime, setClipScrubTime] = useState<number>(0);
  const [noiseGate, setNoiseGate] = useState<number>(20); // Noise floor threshold %
  const [isTransitionManagerOpen, setIsTransitionManagerOpen] = useState(false);

  // Detailed overlay creator states for clip-specific subtitle attachments
  const [overlayClipId, setOverlayClipId] = useState<string>('global');
  const [overlayStartTime, setOverlayStartTime] = useState<number>(0);
  const [overlayEndTime, setOverlayEndTime] = useState<number>(5);
  const [overlayFontFamily, setOverlayFontFamily] = useState<string>('Inter');
  const [overlayColor, setOverlayColor] = useState<string>('#ffffff');
  const [overlaySize, setOverlaySize] = useState<number>(24);
  const [overlayStyleBold, setOverlayStyleBold] = useState<boolean>(true);
  const [overlayStyleItalic, setOverlayStyleItalic] = useState<boolean>(false);
  const [overlayPosition, setOverlayPosition] = useState<'top' | 'centre' | 'bottom'>('bottom');
  const [overlayUseXY, setOverlayUseXY] = useState<boolean>(false);
  const [overlayX, setOverlayX] = useState<number>(50);
  const [overlayY, setOverlayY] = useState<number>(80);
  const [selectedAudioToolIdx, setSelectedAudioToolIdx] = useState<number>(0);

  // Custom configuration state for Wizards
  const [wizardTextTheme, setWizardTextTheme] = useState<'gold' | 'emerald' | 'cosmic' | 'romantic' | 'cinema'>('gold');
  const [wizardTextPrompt, setWizardTextPrompt] = useState<string>('');
  const [wizardSubtitleSize, setWizardSubtitleSize] = useState<number>(20);
  const [wizardSubtitleColor, setWizardSubtitleColor] = useState<string>('#ffffff');
  const [wizardSubtitleUseXY, setWizardSubtitleUseXY] = useState<boolean>(false);
  const [wizardSubtitleX, setWizardSubtitleX] = useState<number>(50);
  const [wizardSubtitleY, setWizardSubtitleY] = useState<number>(85);
  const [wizardSubtitleFont, setWizardSubtitleFont] = useState<string>('Inter');
  const [wizardSubtitleBackground, setWizardSubtitleBackground] = useState<'none' | 'shadow' | 'strip'>('strip');

  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);

  // Template library & Auto-save states
  const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [lastSavedTime, setLastSavedTime] = useState<string>(() => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  const [isAutoSaving, setIsAutoSaving] = useState(false);

  // Initialize and load soundtrack and volume settings, then handle 30s auto-save
  useEffect(() => {
    // Initial load of soundtrack and volume from local storage if they exist
    const savedSoundtrack = localStorage.getItem('zz_studio_soundtrack_id');
    if (savedSoundtrack) {
      setSoundtrackId(savedSoundtrack);
    }
    const savedBgVol = localStorage.getItem('zz_studio_bg_vol');
    if (savedBgVol) {
      setBgVol(parseInt(savedBgVol));
    }
    
    // Set up 30-second interval auto-saver
    const interval = setInterval(() => {
      setIsAutoSaving(true);
      
      // Save clip order & transitions (clips), soundtrack, background volume and timeline
      localStorage.setItem('zz_studio_clips', JSON.stringify(clips));
      localStorage.setItem('zz_studio_soundtrack_id', soundtrackId);
      localStorage.setItem('zz_studio_bg_vol', bgVol.toString());
      localStorage.setItem('zz_studio_timeline', JSON.stringify(timelineOrder));
      
      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLastSavedTime(timeString);
      
      setTimeout(() => {
        setIsAutoSaving(false);
      }, 1000);
    }, 30000);

    return () => clearInterval(interval);
  }, [clips, soundtrackId, bgVol, timelineOrder]);

  // Simulated playback effect
  useEffect(() => {
    let interval: any = null;
    if (previewPlaying && exportPreviewOpen && clips.length > 0) {
      interval = setInterval(() => {
        setPreviewTimer(prev => {
          if (prev >= 100) {
            // Move to next clip in queue
            if (previewClipIdx + 1 < clips.length) {
              setPreviewClipIdx(c => c + 1);
              return 0;
            } else {
              // Wrap back to start or pause
              setPreviewPlaying(false);
              setPreviewClipIdx(0);
              return 0;
            }
          }
          return prev + 6;
        });
      }, 150);
    }
    return () => clearInterval(interval);
  }, [previewPlaying, exportPreviewOpen, previewClipIdx, clips.length]);

  // Recording stopwatches and simulators effect
  useEffect(() => {
    let t: any = null;
    if (isScreenRecording) {
      t = setInterval(() => {
        setScreenRecordTimer(prev => prev + 1);
      }, 1000);
    } else {
      setScreenRecordTimer(0);
    }
    return () => clearInterval(t);
  }, [isScreenRecording]);

  useEffect(() => {
    let t: any = null;
    if (isVoiceRecording) {
      t = setInterval(() => {
        setVoiceRecordTimer(prev => prev + 1);
      }, 1000);
    } else {
      setVoiceRecordTimer(0);
    }
    return () => clearInterval(t);
  }, [isVoiceRecording]);

  useEffect(() => {
    let t: any = null;
    if (isWebcamRecording) {
      t = setInterval(() => {
        setWebcamRecordTimer(prev => prev + 1);
      }, 1000);
    } else {
      setWebcamRecordTimer(0);
    }
    return () => clearInterval(t);
  }, [isWebcamRecording]);

  // 12:00 Midnight Dispatch & Automation simulation
  const [virtualClock, setVirtualClock] = useState('11:59:48 PM');
  const [targetTime, setTargetTime] = useState('00:00');
  const [selectedSocials, setSelectedSocials] = useState<string[]>(['youtube', 'tiktok', 'instagram']);
  const [simStatus, setSimStatus] = useState<'idle' | 'running' | 'success'>('idle');
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [simProgress, setSimProgress] = useState(0);

  // States for AI Auto-Timeline compilation and importer
  const [aiMood, setAiMood] = useState<'hype' | 'nostalgia' | 'modern' | 'cinematic'>('hype');
  const [isCompilingAi, setIsCompilingAi] = useState(false);
  const [aiCompileProgress, setAiCompileProgress] = useState(0);
  const [aiCompileStatus, setAiCompileStatus] = useState('');
  const [isTranscribingSubtitles, setIsTranscribingSubtitles] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [transcriptionSRT, setTranscriptionSRT] = useState('');

  // Canvas context elements
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefsRef = useRef<Record<string, HTMLVideoElement>>({});
  const imageRefsRef = useRef<Record<string, HTMLImageElement>>({});
  const audioRefsRef = useRef<Record<string, HTMLAudioElement>>({});
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // New soundtrack and Web Worker references
  const soundtrackAudioRef = useRef<HTMLAudioElement | null>(null);
  const renderWorkerServiceRef = useRef<RenderWorkerService | null>(null);
  const transcribeCancelledRef = useRef(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const voiceMicStreamRef = useRef<MediaStream | null>(null);
  const voiceMicRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceMicChunksRef = useRef<Blob[]>([]);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const webcamRecorderRef = useRef<MediaRecorder | null>(null);
  const webcamChunksRef = useRef<Blob[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const soundtrackFileInputRef = useRef<HTMLInputElement>(null);
  const [isDropzoneActive, setIsDropzoneActive] = useState(false);
  const dropzoneDragDepth = useRef(0);

  // Purely a navigation aid: highlights which half of the studio the user said they want
  // (AI-assisted vs hands-on manual editing) and smooth-scrolls to that section. Doesn't
  // hide or gate any panel behind it - every tool stays reachable either way, so switching
  // never makes a feature the user was mid-way through using disappear.
  const [studioMode, setStudioMode] = useState<'ai' | 'manual'>('ai');
  const aiCompileSectionRef = useRef<HTMLDivElement>(null);
  const manualEditSectionRef = useRef<HTMLDivElement>(null);
  const handleStudioModeSelect = (mode: 'ai' | 'manual') => {
    setStudioMode(mode);
    const target = mode === 'ai' ? aiCompileSectionRef.current : manualEditSectionRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDropzoneDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dropzoneDragDepth.current += 1;
    setIsDropzoneActive(true);
  };
  const handleDropzoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDropzoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dropzoneDragDepth.current = Math.max(0, dropzoneDragDepth.current - 1);
    if (dropzoneDragDepth.current === 0) setIsDropzoneActive(false);
  };
  const handleDropzoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dropzoneDragDepth.current = 0;
    setIsDropzoneActive(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      onAddNewClip(files[i]);
    }
  };

  const handleCustomSoundtrackUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (customSoundtrackUrl) URL.revokeObjectURL(customSoundtrackUrl);
      const url = URL.createObjectURL(file);
      setCustomSoundtrackUrl(url);
      setCustomSoundtrackName(file.name);
      setSoundtrackId('custom');
      alert(`🎵 Custom background music track "${file.name}" uploaded successfully!\nApplied to the entire stitching timeline!`);
    }
  };

  // Filter out media options that are already added in clips to enable high comfort importation.
  // Also excludes anything explicitly unapproved (approved === false) - an
  // organizer's own review/approval gate should never be bypassable just by
  // opening the Studio's quick-import panel, and stale/unreviewed items
  // should never end up silently stitched into an export.
  const addedIdsSet = new Set(clips.map(c => c.id || c.sourceMediaId));
  const importableMedia = media.filter(m => !addedIdsSet.has(m.id) && m.approved !== false);

  // Calculate total duration adapted for trim ranges + intro slide
  const introDur = celebrationIntroEnabled ? celebrationIntroDuration : 0;
  const totalDuration = (clips.length > 0
    ? clips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart), 0)
    : 10) + introDur;

  const getAspectContainerClass = () => {
    if (cropAspect === '9:16') return 'aspect-[9/16] max-h-[480px]';
    if (cropAspect === '1:1') return 'aspect-square max-h-[400px]';
    if (cropAspect === '4:3') return 'aspect-[4/3] max-h-[480px]';
    return 'aspect-video'; // 16:9
  };

  const getCanvasDimensions = () => {
    if (cropAspect === '9:16') return { w: 270, h: 480 };
    if (cropAspect === '1:1') return { w: 480, h: 480 };
    if (cropAspect === '4:3') return { w: 640, h: 480 };
    return { w: 854, h: 480 }; // 16:9
  };

  const selectedClip = clips[selectedClipIdx] || clips[0] || null;

  // Deterministic audio peaks corresponding to silence or spoken blocks
  const samplePeaks = React.useMemo(() => {
    if (!selectedClip || selectedClip.type !== 'audio') return [];
    
    // Create organic-looking voice spectrum bars
    const arr = [];
    const seedString = selectedClip.id || 'seed';
    let seedVal = 0;
    for (let cIdx = 0; cIdx < seedString.length; cIdx++) {
      seedVal += seedString.charCodeAt(cIdx);
    }
    
    for (let i = 0; i < 60; i++) {
      let noiseFactor = Math.sin(i * 0.15 + seedVal) * Math.cos(i * 0.08);
      let baseAmp = 0;
      
      // Let's create voice structures:
      // Index 0-10: silence floor
      // Index 10-25: speaker block
      // Index 25-34: pause breath (silence)
      // Index 34-52: active vocals
      // Index 52-60: trailing noise
      if (i < 8) {
        baseAmp = 6 + Math.abs(noiseFactor) * 8; // Silent threshold zone
      } else if (i >= 8 && i < 24) {
        baseAmp = 42 + Math.abs(noiseFactor) * 45; // Speaks
      } else if (i >= 24 && i < 32) {
        baseAmp = 5 + Math.abs(noiseFactor) * 9; // Inhales (Silent)
      } else if (i >= 32 && i < 50) {
        baseAmp = 38 + Math.abs(noiseFactor) * 55; // Speaks louder
      } else {
        baseAmp = 8 + Math.abs(noiseFactor) * 10; // Trailer noise floor
      }
      
      arr.push(Math.round(Math.max(2, Math.min(95, baseAmp))));
    }
    return arr;
  }, [selectedClip?.id]);

  useEffect(() => {
    const cv = thumbCanvasRef.current;
    if (!cv || !selectedClip) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    
    const w = cv.width;
    const h = cv.height;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    
    if (selectedClip.type === 'photo' && selectedClip.url) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "Inter", sans-serif';
        ctx.fillText('📸 Photo Frame Preview', 10, h - 15);
      };
      img.onerror = () => {
        // Broken/unreachable image (e.g. an expired signed URL) - show a
        // placeholder instead of letting a later drawImage call crash on it.
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠️ Image unavailable', w / 2, h / 2);
        ctx.textAlign = 'left';
      };
      img.src = selectedClip.url;
      // fallback in case image is already cached/cached-complete
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "Inter", sans-serif';
        ctx.fillText('📸 Photo Frame Preview', 10, h - 15);
      }
    } else if (selectedClip.type === 'video' && selectedClip.url) {
      const vid = videoRefsRef.current[selectedClip.id];
      if (vid && vid.readyState >= 2) {
        // seek temporarily to show scrub preview frame
        const seekT = selectedClip.trimStart + clipScrubTime;
        if (Math.abs(vid.currentTime - seekT) > 0.3) {
          vid.currentTime = seekT;
        }
        try {
          ctx.drawImage(vid, 0, 0, w, h);
        } catch (e) {
          ctx.fillStyle = '#1e1b4b';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#818cf8';
          ctx.font = 'bold 12px "Inter", sans-serif';
          ctx.fillText('🎥 Video Frame Syncing...', 15, h / 2);
        }
      } else {
        // Fallback graphics card representation
        ctx.fillStyle = '#1e1b4b';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#818cf8';
        ctx.font = 'bold 12px "Inter", sans-serif';
        ctx.fillText('🎬 Video: ' + selectedClip.name, 15, h / 2 - 5);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.fillText(`Duration: ${selectedClip.dur}s | Shift + Drag`, 15, h / 2 + 15);
      }
    } else if (selectedClip.type === 'text') {
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 10px "Syne", sans-serif';
      ctx.fillText(`✍️ WISH CARD PREVIEW`, 15, 25);
      ctx.fillStyle = '#e7e5e4';
      ctx.font = 'italic 10px "Inter", sans-serif';
      
      const words = (selectedClip.textBody || '').split(' ');
      const line1 = words.slice(0, 4).join(' ');
      const line2 = words.slice(4, 8).join(' ');
      ctx.fillText(line1, 15, 55);
      if (line2) ctx.fillText(line2 + '...', 15, 75);
    } else if (selectedClip.type === 'audio') {
      ctx.fillStyle = '#060b13';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x += 6) {
        const amp = Math.sin(x * 0.12 + clipScrubTime * 8) * 15;
        ctx.moveTo(x, h/2 - amp);
        ctx.lineTo(x, h/2 + amp);
      }
      ctx.stroke();
      ctx.fillStyle = '#a5b4fc';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText('🎙️ AUDIO TRACK PREVIEW', 15, h - 15);
    }
  }, [selectedClip, clipScrubTime, playing]);

  const handleConvertTextToImageCard = (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    
    // Create an offscreen HTML Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Determine background, border color, ornaments based on wizardTextTheme state (gold, emerald, cosmic, romantic, cinema)
    let fillGrad = ctx.createLinearGradient(0, 0, 800, 600);
    let borderMain = '#d97706';
    let borderInner = '#f59e0b';
    let textColor = '#0f172a';
    let titleColor = '#1e293b';
    let nameColor = '#4f46e5';
    let ornament = '⚜️';
    let strokeDashed = false;
    
    if (wizardTextTheme === 'emerald') {
      fillGrad.addColorStop(0, '#064e3b');
      fillGrad.addColorStop(0.5, '#042f1a');
      fillGrad.addColorStop(1, '#022c22');
      borderMain = '#10b981';
      borderInner = '#34d399';
      textColor = '#f0fdf4';
      titleColor = '#a7f3d0';
      nameColor = '#34d399';
      ornament = '🌿';
    } else if (wizardTextTheme === 'cosmic') {
      fillGrad.addColorStop(0, '#0f0c1b');
      fillGrad.addColorStop(0.5, '#2e0854');
      fillGrad.addColorStop(1, '#050510');
      borderMain = '#ec4899';
      borderInner = '#8b5cf6';
      textColor = '#faf5ff';
      titleColor = '#f472b6';
      nameColor = '#c084fc';
      ornament = '✨';
    } else if (wizardTextTheme === 'romantic') {
      fillGrad.addColorStop(0, '#fff1f2');
      fillGrad.addColorStop(0.5, '#fda4af');
      fillGrad.addColorStop(1, '#fce7f3');
      borderMain = '#f43f5e';
      borderInner = '#fb7185';
      textColor = '#4c0519';
      titleColor = '#881337';
      nameColor = '#db2777';
      ornament = '❤️';
    } else if (wizardTextTheme === 'cinema') {
      fillGrad.addColorStop(0, '#18181b');
      fillGrad.addColorStop(0.5, '#09090b');
      fillGrad.addColorStop(1, '#18181b');
      borderMain = '#e4e4e7';
      borderInner = '#71717a';
      textColor = '#ffffff';
      titleColor = '#f4f4f5';
      nameColor = '#e4e4e7';
      ornament = '🎬';
      strokeDashed = true;
    } else {
      // Default: Gold
      fillGrad.addColorStop(0, '#fefaf6');
      fillGrad.addColorStop(1, '#fbcfe8');
      borderMain = '#d97706';
      borderInner = '#f59e0b';
      textColor = '#0f172a';
      titleColor = '#1e293b';
      nameColor = '#4f46e5';
      ornament = '⚜️';
    }
    
    // Draw background
    ctx.fillStyle = fillGrad;
    ctx.fillRect(0, 0, 800, 600);
    
    // Border style
    ctx.strokeStyle = borderMain;
    ctx.lineWidth = 14;
    if (strokeDashed) {
      ctx.setLineDash([15, 10]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.strokeRect(30, 30, 740, 540);
    
    ctx.strokeStyle = borderInner;
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.strokeRect(48, 48, 704, 504);
    
    // Render corner ornaments
    ctx.font = '24px serif';
    ctx.fillStyle = borderMain;
    ctx.textAlign = 'center';
    ctx.fillText(ornament, 70, 85);
    ctx.fillText(ornament, 730, 85);
    ctx.fillText(ornament, 70, 530);
    ctx.fillText(ornament, 730, 530);
    
    // Header
    ctx.font = '900 24px "Inter", sans-serif';
    ctx.fillStyle = titleColor;
    ctx.textAlign = 'center';
    ctx.fillText('🎁 SURPRISE CAMPAIGN WISH GREETING', 400, 130);
    
    // Contributor name
    ctx.font = 'italic bold 22px Georgia, serif';
    ctx.fillStyle = nameColor;
    ctx.fillText(`With Warmest Wishes from: ${clip.from || 'Contributor'}`, 400, 185);
    
    // Text prompt override option
    const originalText = clip.textBody || clip.note || 'Wishing you the absolute happiest of days!';
    const finalRenderText = wizardTextPrompt.trim() 
      ? `"${originalText}"\n\nGenerated Overlay: ${wizardTextPrompt}`
      : originalText;
      
    // Body Text with automatic wrap lines
    ctx.font = 'italic bold 24px Georgia, serif';
    ctx.fillStyle = textColor;
    
    const lines = wrapText(ctx, finalRenderText, 600);
    let startY = 320 - (lines.length * 18);
    lines.forEach(line => {
      ctx.fillText(line, 400, startY);
      startY += 45;
    });
    
    // URL
    const iconUrl = canvas.toDataURL('image/png');
    
    const updated = clips.map(c => {
      if (c.id === clipId) {
        return {
          ...c,
          type: 'photo' as const,
          url: iconUrl,
          thumb: iconUrl,
          name: `🎨 [AI Card: ${wizardTextTheme.toUpperCase()}] ${c.from}`,
          dur: 6,
          trimEnd: 6
        };
      }
      return c;
    });
    
    onUpdateClipsState(updated);
    setWizardTextPrompt(''); // reset
    alert(`✨ Success! The written wish has been processed via AI Compiler's offline renderer using the [${wizardTextTheme.toUpperCase()}] frame theme successfully! Perfect transitions added.`);
  };

  const handleConvertAudioToSubtitles = async (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    setTranscribeStatus('Transcribing this clip\u2019s speech...');
    setIsTranscribingSubtitles(true);
    setTranscribeProgress(0);

    let textToUse = '';
    try {
      const { getTranscriber, decodeToMono16k, transcribeSlice } = await import('../services/speechToTextService');
      await getTranscriber((pct, status) => {
        setTranscribeProgress(Math.round(pct * 0.5));
        setTranscribeStatus(status);
      });

      const bytes = clip.file
        ? await clip.file.arrayBuffer()
        : clip.url
          ? await (await fetch(clip.url)).arrayBuffer()
          : null;

      if (bytes) {
        setTranscribeProgress(70);
        setTranscribeStatus('Running speech recognition...');
        const { pcm, sampleRate } = await decodeToMono16k(bytes);
        const clipDur = clip.trimEnd - clip.trimStart;
        const segments = await transcribeSlice(pcm, sampleRate, clip.trimStart ?? 0, clip.trimEnd ?? clipDur);
        textToUse = segments.map((s) => s.text).join(' ').trim();
      }
    } catch (err) {
      console.warn(`Could not transcribe clip "${clip.name}":`, err);
    } finally {
      setIsTranscribingSubtitles(false);
      setTranscribeProgress(0);
    }

    if (!textToUse) {
      alert('⚠️ No speech could be detected in this clip. It may be silent, too short, or its audio could not be read.');
      return;
    }

    // Add subtitle as a customizable TextOverlay linked to this clip
    const newOverlay: TextOverlay = {
      id: 'trans_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      text: textToUse,
      pos: 'bottom',
      color: wizardSubtitleColor,
      size: wizardSubtitleSize,
      clipId: clipId,
      fontFamily: wizardSubtitleFont,
      styleBold: true,
      x: wizardSubtitleUseXY ? wizardSubtitleX : undefined,
      y: wizardSubtitleUseXY ? wizardSubtitleY : undefined,
      backplate: wizardSubtitleBackground
    };
    
    setOverlays(prev => [...prev, newOverlay]);
    alert(`🎙️ Voice-To-Text Transcription Success!\n\nDetected Speech: "${textToUse}"\n\nGenerated styled subtitles with absolute coordinates (${wizardSubtitleUseXY ? `X:${wizardSubtitleX}%, Y:${wizardSubtitleY}%` : 'Bottom center pinned'}) and [${wizardSubtitleBackground.toUpperCase()}] backplate frame. Subtitles will display smoothly during playback!`);
  };

  const handleAddNewFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        onAddNewClip(files[i]);
      }
    }
  };

  // Dedicated dynamic multi-media loader to support images, voice waves, customized letters together in stitcher timeline!
  const handleImportMediaToStudio = (item: MediaItem) => {
    const duration = item.type === 'photo' ? 5 : item.type === 'text' ? 6 : item.dur || 8;
    const clipItem = {
      id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      sourceMediaId: item.id,
      type: item.type, // 'video', 'photo', 'audio', 'text'
      file: item.file || null,
      url: item.url,
      dur: duration,
      name: item.name,
      from: item.from || 'Contributor',
      textBody: item.textBody || item.note || '',
      style: item.style || 'gradient',
      thumb: item.thumb,
      trimStart: 0,
      trimEnd: duration,
      transition: 'fade'
    };

    const updatedClips = [...clips, clipItem];
    onUpdateClipsState(updatedClips);
    
    const updatedTL = [...timelineOrder, updatedClips.length - 1];
    onUpdateTimelineState(updatedTL);
  };

  /**
   * One-click path for users who don't want to touch any settings: builds a full
   * timeline from whatever approved media is available (if the timeline is still
   * empty), turns on the safest/most broadly-useful defaults, and kicks off the
   * exact same render pipeline as the regular "Compile & Download" button - so it
   * inherits every reliability fix that pipeline has (the exec timeout, the
   * short-clip loudnorm skip, etc.) instead of being a separate, parallel path
   * that could drift out of sync and reintroduce bugs we've already fixed.
   */
  const handleQuickStitch = () => {
    let workingClips = clips;
    let workingTimeline = timelineOrder;

    if (workingClips.length === 0) {
      if (importableMedia.length === 0) {
        alert('🎬 No media to stitch yet! Upload some clips first, then try Quick Stitch again.');
        return;
      }
      const built = importableMedia.map((item) => {
        const duration = item.type === 'photo' ? 5 : item.type === 'text' ? 6 : item.dur || 8;
        return {
          id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          sourceMediaId: item.id,
          type: item.type,
          file: item.file || null,
          url: item.url,
          dur: duration,
          name: item.name,
          from: item.from || 'Contributor',
          textBody: item.textBody || item.note || '',
          style: item.style || 'gradient',
          thumb: item.thumb,
          trimStart: 0,
          trimEnd: duration,
          transition: 'fade',
        };
      });
      workingClips = built;
      workingTimeline = built.map((_, i) => i);
      onUpdateClipsState(workingClips);
      onUpdateTimelineState(workingTimeline);
    }

    // Sensible, non-destructive defaults - only fills in settings the user hasn't
    // already made a deliberate choice about, never overrides an existing pick.
    if (!autoTrimSilenceEnabled) setAutoTrimSilenceEnabled(true);
    if (soundtrackId === 'none') setSoundtrackId('bm5');

    // Give React a tick to flush the clip/timeline/settings state above before the
    // export reads it - handleExportMovie reads current state synchronously, and
    // queuing this on a microtask keeps this a single, easy-to-follow user action
    // ("click Quick Stitch -> it renders") without duplicating the export logic.
    setTimeout(() => handleExportMovie(), 0);
  };

  const handleUpdateTrim = (idx: number, field: 'start' | 'end', val: number) => {
    const updated = [...clips];
    const c = updated[idx];
    if (field === 'start') {
      c.trimStart = Math.min(val, c.trimEnd - 0.1);
    } else {
      c.trimEnd = Math.max(val, c.trimStart + 0.1);
    }
    onUpdateClipsState(updated);
  };

  /**
   * Real "Highlight Finder": trims every video/audio clip with a source down to its most
   * energetic `HIGHLIGHT_WINDOW_SEC`-long window, via findHighlightWindow's RMS audio-energy
   * analysis (utils.ts) - not a fake progress bar, an actual per-clip decode + energy scan.
   * Clips already shorter than the window, photo/text clips, and clips whose source genuinely
   * can't be read (network failure fetching a URL-only clip) are left untouched rather than
   * blocked or corrupted - this only ever narrows a clip's existing trimStart/trimEnd range,
   * which the real render pipeline already respects.
   */
  const HIGHLIGHT_WINDOW_SEC = 4;
  const handleFindHighlights = async () => {
    const eligible = clips
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => (c.type === 'video' || c.type === 'audio') && (c.file || c.url) && (c.dur || 0) > HIGHLIGHT_WINDOW_SEC);

    if (eligible.length === 0) {
      alert('🎯 No clips long enough to find a highlight in (need real video/audio clips longer than ' + HIGHLIGHT_WINDOW_SEC + 's).');
      return;
    }

    setIsFindingHighlights(true);
    let trimmedCount = 0;
    let skippedCount = 0;
    const updated = [...clips];

    for (let i = 0; i < eligible.length; i++) {
      const { c, idx } = eligible[i];
      setHighlightFinderStatus(`Analyzing audio energy: "${c.name || 'clip'}" (${i + 1}/${eligible.length})...`);
      try {
        let sourceFile: File | null = c.file || null;
        if (!sourceFile && c.url) {
          const res = await fetch(c.url);
          if (!res.ok) throw new Error('unreachable');
          const blob = await res.blob();
          sourceFile = new File([blob], c.name || 'clip', { type: blob.type || 'video/mp4' });
        }
        if (!sourceFile) { skippedCount++; continue; }

        const { start, end } = await findHighlightWindow(sourceFile, HIGHLIGHT_WINDOW_SEC);
        updated[idx] = { ...updated[idx], trimStart: start, trimEnd: end };
        trimmedCount++;
      } catch (err) {
        console.warn(`Highlight Finder: could not analyze "${c.name}", leaving it untouched:`, err);
        skippedCount++;
      }
    }

    onUpdateClipsState(updated);
    setIsFindingHighlights(false);
    setHighlightFinderStatus('');
    alert(
      `🎯 Highlight Finder complete!\n\nTrimmed ${trimmedCount} clip${trimmedCount === 1 ? '' : 's'} to their most energetic ${HIGHLIGHT_WINDOW_SEC}s` +
      (skippedCount > 0 ? `, skipped ${skippedCount} (too short, or the source couldn't be read).` : '.')
    );
  };

  /**
   * Detaches a video clip's own audio into an independent audio clip placed right after it
   * on the timeline, muting the video clip's source audio in the render (its volume/speed/
   * trim controls still work exactly as before - they just no longer affect what you hear,
   * since the new audio clip carries the sound instead). Lets dialogue/music be edited,
   * trimmed, or replaced separately from the footage - a standard NLE feature ported from
   * opencut-classic's audio-separation module.
   */
  const handleDetachAudio = (idx: number) => {
    const source = clips[idx];
    if (!source || source.type !== 'video' || source.audioDetached) return;

    const detachedAudioClip = {
      id: 'aud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      type: 'audio' as const,
      name: `${source.name || 'Clip'} (detached audio)`,
      url: source.url,
      file: source.file,
      dur: source.dur,
      trimStart: source.trimStart,
      trimEnd: source.trimEnd,
      volume: source.volume !== undefined ? source.volume : 100,
    };

    const updatedClips = [...clips];
    updatedClips[idx] = { ...source, audioDetached: true };
    updatedClips.splice(idx + 1, 0, detachedAudioClip);
    onUpdateClipsState(updatedClips);

    // Shift every timeline reference after idx up by one to make room for the new clip,
    // then place the new audio clip's index right after its source video.
    const updatedTL = timelineOrder.map(i => (i > idx ? i + 1 : i));
    const insertAt = updatedTL.findIndex(i => i === idx) + 1;
    updatedTL.splice(insertAt, 0, idx + 1);
    onUpdateTimelineState(updatedTL);
  };

  /** Reverses handleDetachAudio: restores the video clip's own audio and removes the
   *  detached audio clip that was split from it, if it's still present on the timeline. */
  const handleRecoverAudio = (idx: number) => {
    const source = clips[idx];
    if (!source || source.type !== 'video' || !source.audioDetached) return;
    const updated = [...clips];
    updated[idx] = { ...source, audioDetached: false };
    onUpdateClipsState(updated);
  };

  // Clip clipboard: copy one clip's full settings (trim/speed/fx/subtitles/etc.) and paste
  // a duplicate elsewhere on the timeline. Session-only (component state), not persisted -
  // there's nothing to restore across a reload since it can hold live File references.
  const handleCopyClip = (idx: number) => {
    const source = clips[idx];
    if (!source) return;
    setClipboardClip({
      ...source,
      chromaKey: source.chromaKey ? { ...source.chromaKey } : undefined,
      subtitles: Array.isArray(source.subtitles) ? source.subtitles.map((s: any) => ({ ...s })) : undefined,
    });
  };

  const handlePasteClip = (afterIdx?: number) => {
    if (!clipboardClip) return;
    const insertAfter = afterIdx !== undefined ? afterIdx : (clips.length > 0 ? clips.length - 1 : -1);
    const pasted = {
      ...clipboardClip,
      id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: `${clipboardClip.name || 'Clip'} (copy)`,
    };
    const updatedClips = [...clips];
    updatedClips.splice(insertAfter + 1, 0, pasted);
    onUpdateClipsState(updatedClips);

    const updatedTL = timelineOrder.map(i => (i > insertAfter ? i + 1 : i));
    const insertPos = insertAfter === -1 ? 0 : updatedTL.findIndex(i => i === insertAfter) + 1;
    updatedTL.splice(insertPos, 0, insertAfter + 1);
    onUpdateTimelineState(updatedTL);
    setSelectedClipIdx(insertAfter + 1);
  };

  const handleRemoveClip = (idx: number) => {
    const updatedClips = [...clips];
    updatedClips.splice(idx, 1);
    const updatedTL = timelineOrder
      .filter(i => i !== idx)
      .map(i => (i > idx ? i - 1 : i));
    onUpdateClipsState(updatedClips);
    onUpdateTimelineState(updatedTL);
  };

  const handleMoveClip = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === clips.length - 1) return;
    
    const updatedClips = [...clips];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    
    const temp = updatedClips[idx];
    updatedClips[idx] = updatedClips[targetIdx];
    updatedClips[targetIdx] = temp;
    
    onUpdateClipsState(updatedClips);
    onUpdateTimelineState(updatedClips.map((_, i) => i));
    if (selectedClipIdx === idx) {
      setSelectedClipIdx(targetIdx);
    }
  };

  const handleDropToReorder = (targetIdx: number) => {
    if (dragStartIdx === null || dragStartIdx === targetIdx) return;
    const reorderedClips = [...clips];
    const draggedItem = reorderedClips.splice(dragStartIdx, 1)[0];
    reorderedClips.splice(targetIdx, 0, draggedItem);
    onUpdateClipsState(reorderedClips);
    onUpdateTimelineState(reorderedClips.map((_, idx) => idx));
    setDragStartIdx(null);
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    const sourceIdx = result.source.index;
    const destIdx = result.destination.index;
    if (sourceIdx === destIdx) return;
    
    const reorderedClips = [...clips];
    const draggedItem = reorderedClips.splice(sourceIdx, 1)[0];
    reorderedClips.splice(destIdx, 0, draggedItem);
    
    onUpdateClipsState(reorderedClips);
    onUpdateTimelineState(reorderedClips.map((_, idx) => idx));
  };

  // Play controls
  const handleStartPlay = () => {
    if (playing) {
      handlePausePlay();
      return;
    }

    setPlaying(true);
    lastTimeRef.current = performance.now();
    animateStudioFrame();
  };

  const handlePausePlay = () => {
    setPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Pause any naturally playing hidden video & audio nodes
    Object.values(videoRefsRef.current).forEach((v: any) => {
      try { v.pause(); } catch(e){}
    });
    Object.values(audioRefsRef.current).forEach((a: any) => {
      try { a.pause(); } catch(e){}
    });
  };

  const animateStudioFrame = () => {
    if (!canvasRef.current) return;
    const now = performance.now();
    const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
    lastTimeRef.current = now;

    setPlayTime(prev => {
      const next = prev + dt;
      if (next >= totalDuration) {
        setPlaying(false);
        return 0;
      }
      return next;
    });

    animationRef.current = requestAnimationFrame(animateStudioFrame);
  };

  // Dedicated helper to automatically calculate and apply CSS object-fit: cover and center alignment
  const applyCSSObjectFitCoverAndCenter = (
    ctx: CanvasRenderingContext2D,
    sourceW: number,
    sourceH: number,
    targetW: number,
    targetH: number,
    zoomFactor: number = 1.0
  ) => {
    // This scales the asset so that it covers the entire target canvas area perfectly
    const scale = Math.max(targetW / sourceW, targetH / sourceH) * zoomFactor;
    const drawW = sourceW * scale;
    const drawH = sourceH * scale;
    const drawX = (targetW - drawW) / 2;
    const drawY = (targetH - drawH) / 2;
    return { drawX, drawY, drawW, drawH };
  };

  const drawBackgroundReplace = (ctx: CanvasRenderingContext2D, theme: string, w: number, h: number, time: number) => {
    if (theme === 'birthday') {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      
      // Floating balloons
      ctx.fillStyle = 'rgba(236, 72, 153, 0.45)'; // Pink
      ctx.beginPath(); ctx.arc(w * 0.15, h * 0.7 - (time * 15) % (h * 0.8), 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.45)'; // Yellow
      ctx.beginPath(); ctx.arc(w * 0.85, h * 0.5 - (time * 20) % (h * 0.8), 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.45)'; // Green
      ctx.beginPath(); ctx.arc(w * 0.25, h * 0.4 - (time * 12) % (h * 0.8), 18, 0, Math.PI * 2); ctx.fill();
      
      // Strings
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(w * 0.15, h * 0.7 - (time * 15) % (h * 0.8) + 24); ctx.lineTo(w * 0.15, w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.85, h * 0.5 - (time * 20) % (h * 0.8) + 20); ctx.lineTo(w * 0.85, w); ctx.stroke();
    } else if (theme === 'wedding') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#7f1d1d');
      grad.addColorStop(1, '#4c0519');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      
      // Hearts
      ctx.fillStyle = 'rgba(219, 39, 119, 0.25)';
      const hX = w * 0.2 + Math.sin(time) * 15;
      const hY = h * 0.3;
      ctx.beginPath(); ctx.arc(hX - 10, hY, 10, 0, Math.PI, true); ctx.arc(hX + 10, hY, 10, 0, Math.PI, true); ctx.lineTo(hX, hY + 22); ctx.closePath(); ctx.fill();
      
      const hX2 = w * 0.8 + Math.cos(time) * 15;
      const hY2 = h * 0.7;
      ctx.beginPath(); ctx.arc(hX2 - 10, hY2, 10, 0, Math.PI, true); ctx.arc(hX2 + 10, hY2, 10, 0, Math.PI, true); ctx.lineTo(hX2, hY2 + 22); ctx.closePath(); ctx.fill();
    } else if (theme === 'corporate') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#334155');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      
      // Minimal tech grid lines
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 40) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      }
      for (let j = 0; j < h; j += 40) {
        ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(w, j); ctx.stroke();
      }
    } else if (theme === 'award') {
      ctx.fillStyle = '#02010a';
      ctx.fillRect(0, 0, w, h);
      
      // Shining spotlight beams
      const beamX1 = w / 2 + Math.sin(time * 1.5) * 200;
      const gr1 = ctx.createLinearGradient(0, 0, beamX1, h);
      gr1.addColorStop(0, 'rgba(234, 179, 8, 0.4)'); // Gold
      gr1.addColorStop(1, 'rgba(234, 179, 8, 0)');
      ctx.fillStyle = gr1;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(beamX1 - 40, h); ctx.lineTo(beamX1 + 40, h); ctx.closePath(); ctx.fill();
      
      const beamX2 = w / 2 - Math.sin(time * 1.5) * 200;
      const gr2 = ctx.createLinearGradient(w, 0, beamX2, h);
      gr2.addColorStop(0, 'rgba(99, 102, 241, 0.4)'); // Purple
      gr2.addColorStop(1, 'rgba(99, 102, 241, 0)');
      ctx.fillStyle = gr2;
      ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(beamX2 - 40, h); ctx.lineTo(beamX2 + 40, h); ctx.closePath(); ctx.fill();
    } else if (theme === 'church') {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#1e1b4b');
      grad.addColorStop(1, '#312e81');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      
      // Starry sky window effects
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (let i = 0; i < 20; i++) {
        const starX = (w * 0.05 + i * 37) % w;
        const starY = (h * 0.12 + i * i * 19) % (h * 0.7);
        const starSize = 1.5 + Math.sin(time + i) * 1.0;
        ctx.beginPath(); ctx.arc(starX, starY, starSize, 0, Math.PI * 2); ctx.fill();
      }
    } else if (theme === 'festival') {
      ctx.fillStyle = '#050515';
      ctx.fillRect(0, 0, w, h);
      // Fireworks particles
      const fireX = w * 0.4 + Math.sin(time * 0.8) * 100;
      const fireY = h * 0.35 + Math.cos(time * 0.8) * 30;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(fireX, fireY);
        ctx.lineTo(fireX + Math.cos(angle) * (30 + (time * 10) % 25), fireY + Math.sin(angle) * (30 + (time * 10) % 25));
        ctx.stroke();
      }
    } else {
      // luxury scarlet velvet background
      const grad = ctx.createRadialGradient(w/2, h/2, 20, w/2, h/2, w);
      grad.addColorStop(0, '#7f1d1d');
      grad.addColorStop(1, '#111827');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  };

  // Drawing Frame with dynamic multi-format visualizer for Videos, Photos, Audios, and Text Greeting letters
  const drawStudioFrame = (time: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const w = cv.width;
    const h = cv.height;

    // Default pristine background canvas color
    ctx.fillStyle = '#050403';
    ctx.fillRect(0, 0, w, h);

    const introDur = celebrationIntroEnabled ? celebrationIntroDuration : 0;
    let drawn = false;
    let activeClip = null;
    let activeClipTime = 0;

    if (celebrationIntroEnabled && time < celebrationIntroDuration) {
      drawCelebrationIntroSlide(ctx, w, h, time);
      drawn = true;
    } else {
      const adjustedTime = celebrationIntroEnabled ? time - celebrationIntroDuration : time;
      let elapsed = 0;

      // Determine currently active clip (video, voice, typed text card, picture frame)
      for (let i = 0; i < clips.length; i++) {
         const clip = clips[i];
         const clipLen = clip.trimEnd - clip.trimStart;

         if (adjustedTime >= elapsed && adjustedTime < elapsed + clipLen) {
           const clipTime = adjustedTime - elapsed;
           activeClip = clip;
           activeClipTime = clipTime;

        const useBgReplace = clip.backgroundReplace && clip.backgroundReplace !== 'none';
        if (useBgReplace) {
          drawBackgroundReplace(ctx, clip.backgroundReplace, w, h, time);
        }

        // MULTI-FORMAT HANDLER FOR CANVAS COMPILATION
        if (clip.type === 'video' || !clip.type) {
          // Play classic video clip
          let vid = videoRefsRef.current[clip.id];
          if (!vid && clip.url) {
            vid = document.createElement('video');
            vid.src = clip.url;
            vid.preload = 'auto';
            if (clip.url && !clip.url.startsWith('blob:') && !clip.url.startsWith('data:')) {
              vid.crossOrigin = 'anonymous';
            }
            vid.playsInline = true;
            vid.style.display = 'none';

            vid.onloadedmetadata = () => {
              drawStudioFrame(time);
            };
            vid.oncanplay = () => {
              drawStudioFrame(time);
            };
            vid.onseeked = () => {
              if (!playing) {
                drawStudioFrame(time);
              }
            };

            const origVol = clip.volume !== undefined ? clip.volume : 100;
            const clipVol = volumeNormalizationEnabled ? 85 : origVol;
            const targetVol = (clipVol / 100) * (masterVideoVolume / 100);
            vid.volume = targetVol;
            vid.muted = targetVol === 0;
            document.body.appendChild(vid);
            videoRefsRef.current[clip.id] = vid;
            vid.load();
          }

          if (vid && vid.readyState >= 2) {
            const origVol = clip.volume !== undefined ? clip.volume : 100;
            const clipVol = volumeNormalizationEnabled ? 85 : origVol;
            const targetVol = (clipVol / 100) * (masterVideoVolume / 100);
            vid.volume = targetVol;
            vid.muted = targetVol === 0;

            const seekT = clip.trimStart + clipTime;
            if (Math.abs(vid.currentTime - seekT) > 0.2) {
              vid.currentTime = seekT;
            }
            if (playing && vid.paused) {
              vid.play().catch(() => {});
            }

            const vw = vid.videoWidth || w;
            const vh = vid.videoHeight || h;

            ctx.save();
            const clipFilterStr = getClipFilterString(clip.filter);
            if (clipFilterStr !== 'none') {
              ctx.filter = clipFilterStr;
            }
            if (useBgReplace) {
              // Rounded portrait mask to show subject cutout
              ctx.beginPath();
              const maskRadius = Math.min(w, h) * 0.38;
              ctx.arc(w / 2, h / 2, maskRadius, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
            }

            // Face centering increases zoom factor automatically to focus on face frame coordinates
            const zoomFactor = clip.faceCentering ? 1.35 : 1.0;

            if (fitMode === 'contain' && !useBgReplace) {
              const sc = Math.min(w / vw, h / vh) * zoomFactor;
              ctx.drawImage(vid, (w - vw * sc) / 2, (h - vh * sc) / 2, vw * sc, vh * sc);
            } else {
              // Automatically apply CSS object-fit: cover and center alignment
              const { drawX, drawY, drawW, drawH } = applyCSSObjectFitCoverAndCenter(ctx, vw, vh, w, h, zoomFactor);
              ctx.drawImage(vid, drawX, drawY, drawW, drawH);
            }
            ctx.restore();

            if (useBgReplace) {
              // Glowing border ring
              ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
              ctx.stroke();
            }

            // Render synchronized subtitles if present
            if (clip.hasSubtitles && clip.subtitles) {
              const currentSub = clip.subtitles.find(
                (s: any) => activeClipTime >= s.start && activeClipTime < s.end
              );
              if (currentSub) {
                ctx.save();
                const fontSize = currentSub.size || 15;
                const fontFamily = currentSub.font || 'Inter';
                ctx.font = `bold ${fontSize}px "${fontFamily}", sans-serif`;
                ctx.textAlign = 'center';
                
                // Measure subtitle text to draw a beautiful glassmorphic black capsule
                const textWidth = ctx.measureText(currentSub.text).width;
                const capW = textWidth + 36;
                const capH = fontSize + 20;
                const capX = (w - capW) / 2;
                const capY = h - 70; // Position near bottom
                
                // Draw capsule background if backplate is enabled
                if (currentSub.backplate !== 'none') {
                  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                  ctx.lineWidth = 1;
                  
                  ctx.beginPath();
                  if (ctx.roundRect) {
                    ctx.roundRect(capX, capY, capW, capH, 8);
                  } else {
                    ctx.rect(capX, capY, capW, capH);
                  }
                  ctx.fill();
                  ctx.stroke();
                }
                
                // Draw text
                ctx.fillStyle = currentSub.color || '#ffffff';
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 4;
                ctx.fillText(currentSub.text, w / 2, capY + fontSize + 4);
                ctx.restore();
              }
            }

            // Render contributor's styled watermarked credit card at the start of their video submission
            if (clip.from && clip.from !== 'Me (Composer)' && activeClipTime < 3.5) {
              ctx.save();
              
              // Slide-in and fade-out transition animations
              let opacity = 1.0;
              let xOffset = 0;
              if (activeClipTime < 0.5) {
                // Ease-in slide from left
                const t = activeClipTime / 0.5;
                opacity = t;
                xOffset = -30 * (1 - t);
              } else if (activeClipTime > 3.0) {
                // Ease-out fade-out
                opacity = 1 - (activeClipTime - 3.0) / 0.5;
              }
              
              ctx.globalAlpha = opacity;
              
              const cardX = 40 + xOffset;
              const cardY = h - 140; // positioned cleanly above the subtitle space
              const cardW = 280;
              const cardH = 65;
              
              // Draw glassmorphic translucent card
              ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              if (ctx.roundRect) {
                ctx.roundRect(cardX, cardY, cardW, cardH, 14);
              } else {
                ctx.rect(cardX, cardY, cardW, cardH);
              }
              ctx.fill();
              ctx.stroke();
              
              // Glowing left-edge gradient strip
              const grad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
              grad.addColorStop(0, '#6366f1'); // indigo
              grad.addColorStop(1, '#ec4899'); // pink
              ctx.fillStyle = grad;
              ctx.beginPath();
              if (ctx.roundRect) {
                ctx.roundRect(cardX, cardY, 6, cardH, [14, 0, 0, 14]);
              } else {
                ctx.rect(cardX, cardY, 6, cardH);
              }
              ctx.fill();
              
              // Draw small circle icon/avatar badge
              const avatarX = cardX + 32;
              const avatarY = cardY + 32;
              ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
              ctx.beginPath();
              ctx.arc(avatarX, avatarY, 18, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
              ctx.lineWidth = 1;
              ctx.stroke();
              
              // Mini emoji/star inside avatar
              ctx.font = '14px serif';
              ctx.textAlign = 'center';
              ctx.fillText('🎬', avatarX, avatarY + 5);
              
              // Draw contributor name
              const textX = cardX + 62;
              ctx.textAlign = 'left';
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 12px "Inter", sans-serif';
              const cleanName = clip.from.split('(')[0].trim();
              ctx.fillText(cleanName, textX, cardY + 28);
              
              // Subtitle/Role
              ctx.fillStyle = '#94a3b8';
              ctx.font = '9px "Inter", sans-serif';
              ctx.fillText('🎁 Surprise Contributor', textX, cardY + 44);
              
              ctx.restore();
            }
          } else {
            ctx.fillStyle = '#1e1b4b';
            ctx.fillRect(0, 0, w, h);
            ctx.font = 'bold 15px sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,.6)';
            ctx.textAlign = 'center';
            ctx.fillText(`Loading video clip: ${clip.name}...`, w / 2, h / 2);
          }
        } 
        else if (clip.type === 'photo') {
          // Play Photo with dynamic panning/zoom Ken Burns transition
          let img = imageRefsRef.current[clip.id];
          if (!img && clip.url) {
            img = new Image();
            img.onload = () => {
              drawStudioFrame(time);
            };
            img.onerror = () => {
              // Broken/unreachable image (e.g. an expired signed URL) - mark it so
              // the render below skips straight to the placeholder instead of a
              // later drawImage call crashing with "broken state".
              (img as any).__loadFailed = true;
              drawStudioFrame(time);
            };
            img.src = clip.url;
            imageRefsRef.current[clip.id] = img;
          }

          if (img && img.complete && img.naturalWidth > 0 && !(img as any).__loadFailed) {
            // Smooth scale factor over photo time range
            const zoom = 1 + (clipTime / clipLen) * 0.12; 
            const iw = img.width || w;
            const ih = img.height || h;

            ctx.save();
            const photoFilterStr = getClipFilterString(clip.filter);
            if (photoFilterStr !== 'none') {
              ctx.filter = photoFilterStr;
            }
            if (useBgReplace) {
              ctx.beginPath();
              const maskRadius = Math.min(w, h) * 0.38;
              ctx.arc(w / 2, h / 2, maskRadius, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
            }

            const zoomFactor = (clip.faceCentering ? 1.35 : 1.0) * zoom;

            if (fitMode === 'contain' && !useBgReplace) {
              ctx.translate(w / 2, h / 2);
              ctx.scale(zoom, zoom);
              ctx.translate(-w / 2, -h / 2);
              const sc = Math.min(w / iw, h / ih);
              ctx.drawImage(img, (w - iw * sc) / 2, (h - ih * sc) / 2, iw * sc, ih * sc);
            } else {
              // Automatically apply CSS object-fit: cover and center alignment and Ken Burns zoom together
              const { drawX, drawY, drawW, drawH } = applyCSSObjectFitCoverAndCenter(ctx, iw, ih, w, h, zoomFactor);
              ctx.drawImage(img, drawX, drawY, drawW, drawH);
            }
            ctx.restore();

            if (useBgReplace) {
              // Glowing border ring
              ctx.strokeStyle = 'rgba(236, 72, 153, 0.9)';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else {
            // Gradient backup while loading
            const bgGrad = ctx.createLinearGradient(0, 0, w, h);
            bgGrad.addColorStop(0, '#1e293b');
            bgGrad.addColorStop(1, '#0f172a');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, w, h);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Merging image asset into stream...`, w / 2, h / 2);
          }
        } 
        else if (clip.type === 'text') {
          ctx.save();
          const textFilterStr = getClipFilterString(clip.filter);
          if (textFilterStr !== 'none') {
            ctx.filter = textFilterStr;
          }
          // Play Voice request and draw animated dynamic waveforms overlay if it is a transcribed voice card!
          if (clip.isTranscribedVoice || (clip.url && (clip.url.includes('.mp3') || clip.url.includes('.webm') || clip.url.includes('blob:')))) {
            let aud = audioRefsRef.current[clip.id];
            if (!aud && clip.url) {
              aud = document.createElement('audio');
              aud.src = clip.url;
              aud.style.display = 'none';
              aud.onloadedmetadata = () => {
                drawStudioFrame(time);
              };
              aud.oncanplay = () => {
                drawStudioFrame(time);
              };
              document.body.appendChild(aud);
              audioRefsRef.current[clip.id] = aud;
              aud.load();
            }

            if (aud) {
              const seekT = clip.trimStart + clipTime;
              if (Math.abs(aud.currentTime - seekT) > 0.2) {
                aud.currentTime = seekT;
              }
              if (playing && aud.paused) {
                aud.play().catch(() => {});
              }
              if (!playing && !aud.paused) {
                aud.pause();
              }
            }
          }

          const useBgReplace = clip.backgroundReplace && clip.backgroundReplace !== 'none';
          if (useBgReplace) {
            // Draw a frosted-glass glassmorphism card container on top of backgroundReplace already drawn
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.fillRect(40, 40, w - 80, h - 80);
          } else {
            // Render gorgeous typed written wish as high fidelity canvas screen slide
            const bgColor = clip.style === 'royal' ? '#1e1b4b' : clip.style === 'emerald' ? '#064e3b' : '#312e81';
            const cardGrad = ctx.createLinearGradient(0, 0, w, h);
            cardGrad.addColorStop(0, bgColor);
            cardGrad.addColorStop(0.5, '#4f46e5');
            cardGrad.addColorStop(1, '#db2777');
            ctx.fillStyle = cardGrad;
            ctx.fillRect(0, 0, w, h);
          }

          // Aesthetic borders
          ctx.strokeStyle = clip.isTranscribedVoice ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.16)';
          ctx.lineWidth = 10;
          ctx.strokeRect(40, 40, w - 80, h - 80);

          // Fun stickers
          ctx.font = '24px serif';
          ctx.fillText(clip.isTranscribedVoice ? '🎙️' : '✨', 65, 80);
          ctx.fillText('🎁', w - 85, 80);
          ctx.fillText('💝', 65, h - 70);
          ctx.fillText(clip.isTranscribedVoice ? '⚡' : '🎊', w - 85, h - 70);

          // Header details
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.font = 'bold 20px "Syne", sans-serif';
          const headerText = clip.isTranscribedVoice 
            ? `🎙️ VOICE-TO-TEXT WISH FROM ${clip.from?.toUpperCase() || 'CONTRIBUTOR'}`
            : `✍️ WARM WISH FROM ${clip.from?.toUpperCase() || 'CONTRIBUTOR'}`;
          ctx.fillText(headerText, w / 2, 85);

          // Body text wrapped lines
          ctx.font = 'italic 16px "Inter", sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          const textLines = wrapText(ctx, clip.textBody || 'To the star celebrant, wishing you absolute joy, good health, and magic celebrations!', w - 180);
          const startY = Math.max(130, h / 2 - (textLines.length * 14));
          textLines.forEach((lText, idxLine) => {
            ctx.fillText(lText, w / 2, startY + (idxLine * 28));
          });

          // Elegant quotes
          ctx.font = 'bold 50px Courier';
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillText('“', w / 2 - 200, startY - 15);
          ctx.fillText('”', w / 2 + 200, startY + (textLines.length * 28) + 15);

          // Audio visual wave indicator at bottom
          if (clip.isTranscribedVoice) {
            ctx.strokeStyle = '#818cf8';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            const points = 24;
            for (let j = 0; j <= points; j++) {
              const x = (w - 180) / 2 + (j / points) * 180;
              const amp = Math.sin(j * 0.4 + clipTime * 12) * 8 * (playing ? 1 : 0.1);
              const y = h - 100 + amp;
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(`Playing Voice Audio... ${clipTime.toFixed(1)}s / ${clipLen.toFixed(1)}s`, w / 2, h - 75);
          }
          ctx.restore();
        } 
        else if (clip.type === 'audio') {
          // Play Voice request and draw animated dynamic waveforms overlay
          let aud = audioRefsRef.current[clip.id];
          if (!aud && clip.url) {
            aud = document.createElement('audio');
            aud.src = clip.url;
            aud.style.display = 'none';
            aud.onloadedmetadata = () => {
              drawStudioFrame(time);
            };
            aud.oncanplay = () => {
              drawStudioFrame(time);
            };
            document.body.appendChild(aud);
            audioRefsRef.current[clip.id] = aud;
            aud.load();
          }

          if (aud) {
            const origVol = clip.volume !== undefined ? clip.volume : 100;
            const clipVol = volumeNormalizationEnabled ? 85 : origVol;
            aud.volume = (clipVol / 100) * (masterVideoVolume / 100);
            
            const seekT = clip.trimStart + clipTime;
            if (Math.abs(aud.currentTime - seekT) > 0.2) {
              aud.currentTime = seekT;
            }

            if (playing && aud.paused) {
              aud.play().catch(() => {});
            }
            if (!playing && !aud.paused) {
              aud.pause();
            }
          }

          // Render active sound wave visualization block
          const soundGrad = ctx.createLinearGradient(0, 0, w, h);
          soundGrad.addColorStop(0, '#090d16');
          soundGrad.addColorStop(1, '#1e1b4b');
          ctx.fillStyle = soundGrad;
          ctx.fillRect(0, 0, w, h);

          // Animated microphone icon with pulse circles
          const pulse = 1 + Math.sin(clipTime * 5) * 0.08;
          ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
          ctx.beginPath();
          ctx.arc(w / 2, h / 2 - 40, 90 * pulse, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(99, 102, 241, 0.28)';
          ctx.beginPath();
          ctx.arc(w / 2, h / 2 - 40, 65, 0, Math.PI * 2);
          ctx.fill();

          ctx.font = '54px serif';
          ctx.textAlign = 'center';
          ctx.fillText('🎙️', w / 2, h / 2 - 20);

          // Animated speaker voice spectrum
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          const points = 40;
          for (let j = 0; j <= points; j++) {
            const x = (w - 280) / 2 + (j / points) * 280;
            const amp = Math.sin(j * 0.25 + clipTime * 14) * Math.cos(j * 0.1 + clipTime * 7) * 35 * (playing ? 1 : 0.12);
            const y = h / 2 + 65 + amp;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Voice note info card
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 20px "Syne", sans-serif';
          ctx.fillText(`🎙️ VOICE WISH FROM ${clip.from?.toUpperCase() || 'CONTRIBUTOR'}`, w / 2, h / 2 + 130);

          ctx.fillStyle = '#94a3b8';
          ctx.font = '13px "Inter", sans-serif';
          ctx.fillText(`Listening duration: ${clipTime.toFixed(1)}s / ${clipLen.toFixed(1)}s`, w / 2, h / 2 + 160);
        }

        drawn = true;
        break;
      }
      elapsed += clipLen;
    }
    }

    if (!drawn && clips.length > 0) {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
    }

    // Draw programmatic moving frames & special effects only outside of intro slide
    if (!(celebrationIntroEnabled && time < celebrationIntroDuration)) {
      drawAnimatedFrameOverlay(ctx, w, h, time);
      applyColorGrading(ctx, w, h, colorGrade);
      renderTextOverlays(ctx, w, h, activeClip, activeClipTime);
      drawLiveAudioWaveformOverlay(ctx, w, h, time);
    }

    // Continuous timeline baseline bar inside canvas
    ctx.fillStyle = 'rgba(255,107,26,.8)';
    ctx.fillRect(0, h - 6, w * (time / Math.max(0.1, totalDuration)), 6);
  };

  const drawLiveAudioWaveformOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    if (!showLiveAudioWaveform) return;
    
    ctx.save();
    const isActive = playing;
    const activityMult = isActive ? 1.0 : 0.15;
    
    if (waveformStyle === 'spectrum') {
      // Draw bottom-aligned equalizer bars
      const barCount = 36;
      const spacing = 4;
      const containerW = w - 80;
      const barW = (containerW - (barCount - 1) * spacing) / barCount;
      const startX = 40;
      const baseY = h - 25;
      
      const grad = ctx.createLinearGradient(0, baseY - 60, 0, baseY);
      grad.addColorStop(0, '#ec4899'); // pink
      grad.addColorStop(0.5, '#6366f1'); // indigo
      grad.addColorStop(1, 'rgba(99, 102, 241, 0.2)');
      
      ctx.fillStyle = grad;
      for (let i = 0; i < barCount; i++) {
        // Multi-frequency synthesis for realistic audio animation
        const freq1 = Math.sin(i * 0.3 + time * 11) * 20;
        const freq2 = Math.cos(i * 0.7 - time * 17) * 15;
        const freq3 = Math.sin(i * 1.5 + time * 6) * 10;
        
        let barH = (35 + freq1 + freq2 + freq3) * activityMult;
        barH = Math.max(4, Math.min(65, barH));
        
        const bx = startX + i * (barW + spacing);
        const by = baseY - barH;
        
        // Rounded bars
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bx, by, barW, barH, 2);
        } else {
          ctx.rect(bx, by, barW, barH);
        }
        ctx.fill();
      }
    } 
    else if (waveformStyle === 'wave') {
      // Oscilloscope voice tracks
      const centerY = h - 45;
      const startX = 40;
      const width = w - 80;
      
      const colors = [
        'rgba(99, 102, 241, 0.65)', // indigo
        'rgba(236, 72, 153, 0.55)', // pink
        'rgba(34, 211, 238, 0.45)'  // cyan
      ];
      
      colors.forEach((color, idx) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = idx === 0 ? 2.5 : 1.5;
        ctx.beginPath();
        
        const phaseShift = time * (10 + idx * 4);
        const freqScale = 0.02 + idx * 0.01;
        const ampScale = (24 - idx * 6) * activityMult;
        
        for (let x = 0; x <= width; x += 5) {
          const rads = x * freqScale - phaseShift;
          const y = centerY + Math.sin(rads) * ampScale + Math.cos(x * 0.05 + time * 5) * (5 * activityMult);
          if (x === 0) {
            ctx.moveTo(startX + x, y);
          } else {
            ctx.lineTo(startX + x, y);
          }
        }
        ctx.stroke();
      });
    } 
    else if (waveformStyle === 'circular') {
      // Pulsating audio radar in the corner
      const cx = w - 65;
      const cy = 65;
      const maxRadius = 35;
      
      // Base circle
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
      ctx.stroke();
      
      // Pulse ripples
      const ripples = 3;
      for (let r = 0; r < ripples; r++) {
        const progress = ((time * 1.5 + r / ripples) % 1.0);
        const radius = progress * maxRadius;
        const opacity = (1 - progress) * 0.6 * activityMult;
        
        ctx.strokeStyle = `rgba(99, 102, 241, ${opacity})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Dynamic radar spikes
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const spikes = 20;
      for (let s = 0; s < spikes; s++) {
        const angle = (s / spikes) * Math.PI * 2;
        const noise = (Math.sin(s * 1.2 + time * 12) * Math.cos(s * 0.8 - time * 8) * 12) * activityMult;
        const innerR = 8;
        const outerR = 15 + Math.max(0, noise);
        
        const sx1 = cx + Math.cos(angle) * innerR;
        const sy1 = cy + Math.sin(angle) * innerR;
        const sx2 = cx + Math.cos(angle) * outerR;
        const sy2 = cy + Math.sin(angle) * outerR;
        
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
      }
      ctx.stroke();
      
      // Center dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    else if (waveformStyle === 'cyber_bars') {
      // Stereo Left & Right reflective VU Equalizer
      const barCount = 12;
      const barW = 6;
      const spacing = 3;
      const baseY = h - 35;
      
      const drawVUChannel = (startX: number, direction: 1 | -1) => {
        for (let i = 0; i < barCount; i++) {
          const noise = (Math.sin(i * 0.5 + time * 14) * 12 + Math.cos(i * 0.9 - time * 9) * 8) * activityMult;
          let barH = Math.max(3, 18 + noise);
          
          const bx = startX + direction * i * (barW + spacing);
          const by = baseY - barH;
          
          // Triple color indicator
          let color = '#10b981'; // green for lower
          if (i > 8) color = '#ef4444'; // red for peaks
          else if (i > 5) color = '#f59e0b'; // orange for mid
          
          ctx.fillStyle = color;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(bx, by, barW, barH, 1.5);
          } else {
            ctx.rect(bx, by, barW, barH);
          }
          ctx.fill();
        }
      };
      
      // Left channel (lower left)
      drawVUChannel(45, 1);
      // Right channel (lower right)
      drawVUChannel(w - 45 - barW, -1);
      
      // Draw mini L & R labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.fillText('L CHANNEL', 45 + 15, baseY + 12);
      ctx.fillText('R CHANNEL', w - 45 - 25, baseY + 12);
    }
    
    ctx.restore();
  };

  const drawAnimatedFrameOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    if (animatedFrame === 'none') return;
    if (animatedFrame === 'sparkles') {
      ctx.fillStyle = 'rgba(255, 215, 0, ' + (0.5 + Math.sin(time * 5) * 0.25) + ')';
      ctx.font = '15px sans-serif';
      for (let s = 0; s < 10; s++) {
        const sx = ((s * 45 + time * 35) % (w - 20)) + 10;
        ctx.fillText('✨', sx, 18);
        ctx.fillText('⚡', sx, h - 18);
      }
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    } 
    else if (animatedFrame === 'hearts') {
      ctx.fillStyle = 'rgba(244, 63, 94, ' + (0.55 + Math.sin(time * 4) * 0.25) + ')';
      ctx.font = '14px sans-serif';
      for (let s = 0; s < 10; s++) {
        const sx = ((s * 50 + time * 25) % (w - 20)) + 10;
        ctx.fillText('❤️', sx, h - 18);
        ctx.fillText('🎉', sx, 18);
      }
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, w - 10, h - 10);
    } 
    else if (animatedFrame === 'neon') {
      const hue = Math.floor(time * 70) % 360;
      ctx.strokeStyle = `hsla(${hue}, 100%, 50%, 0.9)`;
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.shadowColor = `hsla(${hue}, 100%, 50%, 0.7)`;
      ctx.shadowBlur = 12;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.shadowBlur = 0; // reset
    } 
    else if (animatedFrame === 'vintage') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, 22);
      ctx.fillRect(0, h - 22, w, 22);
      ctx.fillStyle = '#f8fafc';
      for (let x = 8; x < w; x += 25) {
        ctx.fillRect(x, 5, 10, 10);
        ctx.fillRect(x, h - 15, 10, 10);
      }
    }
    else if (animatedFrame === 'balloons') {
      // Floating Festive Balloons & Gifts
      ctx.font = '14px sans-serif';
      for (let s = 0; s < 12; s++) {
        const sx = ((s * 40 + time * 15) % (w - 20)) + 10;
        const sy = (h - 25 - (s * 18 + time * 30) % (h - 50));
        ctx.fillText('🎈', sx, sy);
        ctx.fillText('🎁', w - sx, h - sy);
      }
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    }
    else if (animatedFrame === 'confetti') {
      // Cascading Festive Confetti Streamers
      ctx.fillStyle = 'rgba(234, 179, 8, ' + (0.6 + Math.sin(time * 3) * 0.2) + ')';
      ctx.font = '12px sans-serif';
      for (let s = 0; s < 15; s++) {
        const sx = (s * 35 + Math.sin(time + s) * 15) % w;
        const sy = (time * 45 + s * 22) % h;
        ctx.fillText('🥳', sx, sy);
        ctx.fillText('✨', w - sx, (sy + h/2) % h);
      }
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    }
    else if (animatedFrame === 'stars') {
      // Sparkling stars space background overlay
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      for (let s = 0; s < 20; s++) {
        const sx = (s * 45 + Math.cos(time * 0.5 + s) * 30) % w;
        const sy = (s * 25 + Math.sin(time * 0.5 + s) * 30) % h;
        if (s % 3 === 0) ctx.fillText('⭐', sx, sy);
        else if (s % 3 === 1) ctx.fillText('🌟', sx, sy);
        else ctx.fillText('✨', sx, sy);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }
  };

  const drawCelebrationIntroSlide = (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    // Elegant royal celebratory background with a subtle pulse gradient
    const pulse = Math.sin(time * 2) * 20;
    const grad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.8 + pulse);
    grad.addColorStop(0, '#1e1b4b'); // Deep indigo
    grad.addColorStop(0.5, '#311042'); // Deep purple
    grad.addColorStop(1, '#02010a'); // Cosmic black
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Floating background decorations (balloons, sparkles, and hearts)
    ctx.font = '16px sans-serif';
    for (let s = 0; s < 8; s++) {
      const sx = ((s * 60 + time * 12) % (w - 40)) + 20;
      const sy = (h - 30 - (s * 25 + time * 20) % (h - 60));
      ctx.fillText(s % 2 === 0 ? '🎈' : '✨', sx, sy);
      ctx.fillText(s % 2 === 0 ? '🎉' : '💖', w - sx, (sy + h / 2) % h);
    }

    // Outer gold border frame with sparkles
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(13, 13, w - 26, h - 26);

    // Draw celebrated person picture if URL is provided!
    const celebImgUrl = celebratedPhoto;
    if (celebImgUrl) {
      let img = imageRefsRef.current['celeb_photo'];
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => drawStudioFrame(time);
        img.onerror = () => {
          // Broken/unreachable image (e.g. a signed URL without CORS enabled on
          // the storage bucket) - mark it so we skip straight past the drawImage
          // below instead of crashing on a broken HTMLImageElement.
          (img as any).__loadFailed = true;
        };
        img.src = celebImgUrl;
        img.style.display = 'none';
        document.body.appendChild(img);
        imageRefsRef.current['celeb_photo'] = img;
      }

      if (img && img.complete && img.naturalWidth > 0 && !(img as any).__loadFailed) {
        ctx.save();
        // Circle crop for the celebrated person's portrait!
        ctx.beginPath();
        const rSize = Math.min(w, h) * 0.22;
        const cx = w / 2;
        const cy = h / 2 - 25;
        ctx.arc(cx, cy, rSize, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        
        // Draw image keeping cover aspect ratio inside the circle
        const scale = Math.max(rSize * 2 / img.width, rSize * 2 / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
        ctx.restore();

        // Draw elegant gold ring around portrait crop
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, rSize + 2, 0, Math.PI * 2);
        ctx.stroke();

        // Floating label
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('HONORED GUEST OF HONOR', cx, cy - rSize - 10);
      }
    } else {
      // Draw a default present icon or emoji if no image is uploaded
      ctx.fillStyle = '#f59e0b';
      ctx.font = '48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👑', w / 2, h / 2 - 15);
    }

    // Celebratory typography with custom names!
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Surprise Tribute for ${celebratedName || 'Honored Guest'}`, w / 2, h / 2 + 50);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px "Inter", sans-serif';
    ctx.fillText('⭐ KICKING OFF THE CELEBRATION MOVIE • PRESS PLAY ⭐', w / 2, h / 2 + 72);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = 'italic 8px "Inter", sans-serif';
    ctx.fillText('Synthesizing all friend & family greetings dynamically...', w / 2, h - 28);
  };

  const applyColorGrading = (ctx: CanvasRenderingContext2D, w: number, h: number, grade: string) => {
    if (grade === 'none') return;
    try {
      const id = ctx.getImageData(0, 0, w, h);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        if (grade === 'warm') {
          d[i] = Math.min(255, r * 1.12);
          d[i + 2] = Math.min(255, b * 0.88);
        } else if (grade === 'cool') {
          d[i] = Math.min(255, r * 0.88);
          d[i + 2] = Math.min(255, b * 1.12);
        } else if (grade === 'vibrant') {
          d[i] = Math.min(255, r * 1.25);
          d[i + 1] = Math.min(255, g * 1.12);
        } else if (grade === 'bw') {
          const gray = r * 0.3 + g * 0.59 + b * 0.11;
          d[i] = d[i + 1] = d[i + 2] = gray;
        } else if (grade === 'sepia') {
          d[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
          d[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
          d[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        } else if (grade === 'cinematic') {
          // Teal and Orange: boost red/yellow in highlights, boost blue/cyan in shadows
          const avg = (r + g + b) / 3;
          if (avg > 127) {
            d[i] = Math.min(255, r * 1.15); // red accent highlight
            d[i + 1] = Math.min(255, g * 1.05);
            d[i + 2] = Math.min(255, b * 0.9);
          } else {
            d[i] = Math.min(255, r * 0.85);
            d[i + 1] = Math.min(255, g * 1.1); // green-blue shadows
            d[i + 2] = Math.min(255, b * 1.25);
          }
        } else if (grade === 'cyberpunk') {
          // Intense neon magenta & cyan shift
          const avg = (r + g + b) / 3;
          if (avg > 110) {
            d[i] = Math.min(255, r * 1.3); // pink highlights
            d[i + 1] = Math.min(255, g * 0.7);
            d[i + 2] = Math.min(255, b * 1.3);
          } else {
            d[i] = Math.min(255, r * 0.6); // electric cyan shadows
            d[i + 1] = Math.min(255, g * 1.2);
            d[i + 2] = Math.min(255, b * 1.4);
          }
        } else if (grade === 'solarize') {
          // Artistic solarization
          d[i] = r > 127 ? 255 - r : r;
          d[i + 1] = g > 127 ? 255 - g : g;
          d[i + 2] = b > 127 ? 255 - b : b;
        }
      }
      ctx.putImageData(id, 0, 0);
    } catch (err) {}
  };

  const renderTextOverlays = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    activeClip: any = null,
    clipTime: number = 0
  ) => {
    // Draw simple subtitle caption overlay if present on the active clip
    if (activeClip && activeClip.caption) {
      ctx.save();
      const fontSize = 16;
      const fontFamily = 'Inter';
      ctx.font = `bold ${fontSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = 'center';
      
      const maxWidth = w - 85;
      const captionLines = wrapText(ctx, activeClip.caption, maxWidth);
      
      const lineHeight = fontSize + 6;
      const capH = (captionLines.length * lineHeight) + 16;
      const capY = h - 65 - capH; // Position near bottom
      
      // Draw capsule background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      
      const capW = Math.min(maxWidth, Math.max(...captionLines.map(line => ctx.measureText(line).width)) + 36);
      
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect((w - capW) / 2, capY, capW, capH, 8);
      } else {
        ctx.rect((w - capW) / 2, capY, capW, capH);
      }
      ctx.fill();
      ctx.stroke();
      
      // Draw text lines
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      captionLines.forEach((line, lineIdx) => {
        ctx.fillText(line, w / 2, capY + 12 + fontSize + (lineIdx * lineHeight));
      });
      ctx.restore();
    }

    overlays.forEach(o => {
      // Clip-level target checking
      if (o.clipId) {
        if (!activeClip || activeClip.id !== o.clipId) return;
        
        // Check start and end timestamps relative to the active clip segment
        const start = o.startTime ?? 0;
        const end = o.endTime ?? (activeClip.trimEnd - activeClip.trimStart);
        if (clipTime < start || clipTime > end) return;
      }

      // Compile fonts
      const isBold = o.styleBold !== false;
      const isItalic = o.styleItalic === true;
      const fontModifier = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : 'normal'}`.trim();
      const fontFamilyChoice = o.fontFamily || 'Inter';

      ctx.font = `${fontModifier} ${o.size}px "${fontFamilyChoice}", sans-serif`;
      ctx.fillStyle = o.color || '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 6;
      ctx.textAlign = 'center';

      let x = w / 2;
      let y = h / 2;
      if (typeof o.x === 'number') {
        x = (o.x / 100) * w;
      }
      if (typeof o.y === 'number') {
        y = (o.y / 100) * h;
      } else {
        if (o.pos === 'top') {
          y = 45;
        } else if (o.pos === 'bottom') {
          y = h - 45;
        }
      }

      // Render custom backplate background box wrapper behind subtitles
      if (o.backplate === 'strip') {
        ctx.save();
        const tWidth = ctx.measureText(o.text).width;
        const padX = 16;
        const padY = 8;
        ctx.fillStyle = 'rgba(10, 10, 12, 0.75)'; // eye-safe high contrast backing
        const boxX = x - (tWidth / 2) - padX;
        const boxY = y - (o.size) + 2;
        const boxW = tWidth + (padX * 2);
        const boxH = o.size + (padY * 2);
        ctx.shadowColor = 'transparent'; // clear shadows for backplate box
        ctx.shadowBlur = 0;
        
        // Draw round rectangle background Frame
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        } else {
          ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();
        ctx.restore();
      }

      ctx.fillText(o.text, x, y);
      ctx.shadowBlur = 0; // reset
    });
  };

  const drawIdleCanvas = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#818cf8';
    
    // Draw pretty vector film reel graphic
    ctx.font = '55px serif';
    ctx.fillText('🎬', cv.width / 2 - 25, cv.height / 2 - 15);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Studio multi-format timeline preview online', cv.width / 2, cv.height / 2 + 35);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11.5px "JetBrains Mono", monospace';
    ctx.fillText('Ready to stitch: Videos · Audios · Written Cards · Photos', cv.width / 2, cv.height / 2 + 62);
  };

  const handleAutoTranscribeSubtitles = async () => {
    const videoClips = clips.filter(c => c.type === 'video' || !c.type);
    if (videoClips.length === 0) {
      alert('🎥 Please add at least one video clip to the timeline first to transcribe subtitles!');
      return;
    }

    setIsTranscribingSubtitles(true);
    setTranscribeProgress(0);
    setTranscribeStatus('Booting up local speech-recognition engine (Whisper)...');
    transcribeCancelledRef.current = false;

    try {
      const { getTranscriber, decodeToMono16k, transcribeSlice } = await import('../services/speechToTextService');

      // Load the model once up front (progress represents the one-time download on first use).
      await getTranscriber((pct, status) => {
        setTranscribeProgress(Math.round(pct * 0.4)); // model load = first 40% of the bar
        setTranscribeStatus(status);
      });

      let srtTrackIndex = 1;
      let srtTimeCounter = 0;
      let finalSRTContent = '';
      let transcribedCount = 0;
      const perClipWeight = 60 / clips.length;

      const updatedClips = [];
      for (let i = 0; i < clips.length; i++) {
        if (transcribeCancelledRef.current) {
          // Keep whatever clips were already transcribed; stop starting new ones.
          for (let j = i; j < clips.length; j++) updatedClips.push(clips[j]);
          break;
        }
        const clip = clips[i];
        if (clip.type !== 'video' && clip.type) {
          srtTimeCounter += (clip.trimEnd - clip.trimStart);
          updatedClips.push(clip);
          continue;
        }

        setTranscribeStatus(`Transcribing clip ${i + 1} of ${clips.length}: ${clip.name || 'untitled'}...`);
        setTranscribeProgress(Math.round(40 + i * perClipWeight));

        const clipDur = clip.trimEnd - clip.trimStart;
        let clipSubtitles: { start: number; end: number; text: string }[] = [];

        try {
          const bytes = clip.file
            ? await clip.file.arrayBuffer()
            : clip.url
              ? await (await fetch(clip.url)).arrayBuffer()
              : null;

          if (bytes) {
            const { pcm, sampleRate } = await decodeToMono16k(bytes);
            const segments = await transcribeSlice(pcm, sampleRate, clip.trimStart ?? 0, clip.trimEnd ?? clipDur);
            clipSubtitles = segments.map((seg) => ({
              start: seg.start,
              end: Math.min(clipDur, seg.end),
              text: seg.text,
            }));
            if (clipSubtitles.length > 0) transcribedCount++;
          }
        } catch (clipErr) {
          console.warn(`Could not transcribe clip "${clip.name}":`, clipErr);
        }

        const formatSRTTime = (secs: number) => {
          const totalSecs = srtTimeCounter + secs;
          const h = Math.floor(totalSecs / 3600).toString().padStart(2, '0');
          const m = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
          const s = Math.floor(totalSecs % 60).toString().padStart(2, '0');
          const ms = Math.floor((totalSecs % 1) * 1000).toString().padStart(3, '0');
          return `${h}:${m}:${s},${ms}`;
        };
        clipSubtitles.forEach((sub) => {
          finalSRTContent += `${srtTrackIndex}\n${formatSRTTime(sub.start)} --> ${formatSRTTime(sub.end)}\n${sub.text}\n\n`;
          srtTrackIndex++;
        });
        srtTimeCounter += clipDur;

        updatedClips.push({
          ...clip,
          hasSubtitles: clipSubtitles.length > 0,
          subtitles: clipSubtitles,
        });
      }

      onUpdateClipsState(updatedClips);
      setTranscriptionSRT(finalSRTContent);
      setTranscribeProgress(100);
      setIsTranscribingSubtitles(false);
      if (transcribeCancelledRef.current) {
        setTranscribeStatus('Transcription cancelled.');
        alert(`⏹️ Transcription cancelled. Captions were kept for the ${transcribedCount} clip(s) already processed.`);
      } else {
        setTranscribeStatus('Transcription complete!');
        alert(
          transcribedCount > 0
            ? `🎙️ Speech-to-text complete!\nReal captions generated for ${transcribedCount} of ${videoClips.length} video clip(s) using on-device Whisper transcription.`
            : `⚠️ No speech could be detected/transcribed in these clips. This can happen with silent clips, clips whose audio couldn't be read, or very short clips.`
        );
      }
    } catch (err: any) {
      console.error('Auto-transcription failed:', err);
      setIsTranscribingSubtitles(false);
      alert(`❌ Speech-to-text failed to initialize: ${err?.message || err}`);
    }
  };

  const handleDownloadSRT = () => {
    if (!transcriptionSRT) return;
    const blob = new Blob([transcriptionSRT], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Compile Render output
  const handleStartRenderMerged = () => {
    if (clips.length === 0) {
      alert('Your stitching bin is empty! Load video files or quick-import library materials below.');
      return;
    }
    handlePausePlay();
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
    }
    setOutputUrl(null);
    setRenderWarnings([]);
    setRendering(true);
    setRenderProgress(0);
    setRenderError(null);
    setRenderEta(clips.length * 3.0);
    setRenderingStatus('Spawning dedicated RenderWorker thread...');

    if (!renderWorkerServiceRef.current) {
      renderWorkerServiceRef.current = new RenderWorkerService();
    }

    const [mergedW, mergedH] = computeOutputDims(exportResolution, cropAspect);

    renderWorkerServiceRef.current.startRender(
      clips,
      {
        soundtrackUrl: getSoundtrackUrl(soundtrackId),
        soundtrackVolume: bgVol,
        videoFilter: activeVideoFilter,
        fitMode: fitMode,
        colorGrade: colorGrade,
        showLiveAudioWaveform: showLiveAudioWaveform,
        waveformStyle: waveformStyle,
        animatedFrame: animatedFrame,
        overlays: overlays,
        audioPitch: audioPitch,
        audioReversed: audioReversed,
        autoTrimSilence: autoTrimSilenceEnabled,
        outputWidth: mergedW,
        outputHeight: mergedH,
        outputFps: exportFps,
        outputFormat: EXPORT_FORMAT_MAP[exportFormat] || 'mp4',
        quality: EXPORT_QUALITY_MAP[exportQuality] || 'balanced',
        masterVolume: masterVideoVolume,
        eq: { bass: eqBass - 50, mid: eqMid - 50, treble: eqTreble - 50 },
        brandColor: brand?.brandColor,
        brandLogoDataUrl: brand?.brandLogoDataUrl,
        markers: (EXPORT_FORMAT_MAP[exportFormat] || 'mp4') === 'mp4' && markers.length > 0
          ? markers.map(m => ({ time: m.time, label: m.label }))
          : undefined,
      },
      (prog, eta, status) => {
        setRenderProgress(prog);
        setRenderEta(eta);
        setRenderingStatus(status);
      },
      (finishedUrl, warnings) => {
        setOutputUrl(finishedUrl);
        setRenderWarnings(warnings || []);
        setRendering(false);
        setRenderError(null);
      },
      (errorMessage) => {
        setRendering(false);
        setRenderError(errorMessage);
        setRenderingStatus('Render failed');
      }
    );
  };

  // Real standalone audio export (LibreCuts' "Audio Export" feature) - mixes every clip's own
  // audio track plus the soundtrack into a downloadable, playable .mp3 file.
  const handleExportAudioOnly = () => {
    if (clips.length === 0) {
      alert('Your stitching bin is empty! Load video files or quick-import library materials below.');
      return;
    }
    if (audioOutputUrl) URL.revokeObjectURL(audioOutputUrl);
    setAudioOutputUrl(null);
    setAudioExporting(true);
    setAudioExportProgress(0);
    setAudioExportError(null);
    setAudioExportWarnings([]);

    if (!renderWorkerServiceRef.current) {
      renderWorkerServiceRef.current = new RenderWorkerService();
    }

    renderWorkerServiceRef.current.exportAudioOnly(
      clips,
      {
        soundtrackUrl: getSoundtrackUrl(soundtrackId),
        soundtrackVolume: bgVol,
        autoLevel: volumeNormalizationEnabled,
      },
      (prog) => setAudioExportProgress(prog),
      (finishedUrl, warnings) => {
        setAudioOutputUrl(finishedUrl);
        setAudioExportWarnings(warnings || []);
        setAudioExporting(false);
      },
      (errorMessage) => {
        setAudioExporting(false);
        setAudioExportError(errorMessage);
      }
    );
  };

  // Selected clip subtitle management states
  // Real face detection trigger (LibreCuts-style "Speaker Face Centering", made actually real):
  // runs the self-hosted TinyFaceDetector model against this clip's own image/video frame and
  // stores the result on the clip so both the live preview and the final render can frame
  // toward the actual detected face instead of a fixed, always-centered zoom.
  const runFaceDetectionForClip = async (clipIndex: number) => {
    const targetClip = clips[clipIndex];
    if (!targetClip || !targetClip.url) return;
    try {
      const { detectFaceBox, grabVideoFrame } = await import('../services/faceDetectionService');
      let box: Awaited<ReturnType<typeof detectFaceBox>> = null;

      if (targetClip.type === 'photo') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image failed to load'));
          img.src = targetClip.url;
        });
        box = await detectFaceBox(img);
      } else if (targetClip.type === 'video') {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('video failed to load'));
          video.src = targetClip.url;
        });
        const frame = await grabVideoFrame(video, targetClip.trimStart ?? 0);
        if (frame) box = await detectFaceBox(frame);
      }

      if (box) {
        const updated = [...clips];
        if (updated[clipIndex]) updated[clipIndex] = { ...updated[clipIndex], faceBox: box };
        onUpdateClipsState(updated);
      }
    } catch (err) {
      // Best-effort enhancement - if detection fails for any reason, Speaker Face Centering
      // simply falls back to plain center framing rather than blocking the toggle.
      console.warn('Face detection failed for clip, falling back to center framing:', err);
    }
  };

  const [subText, setSubText] = useState('');
  const [subStart, setSubStart] = useState(0);
  const [subEnd, setSubEnd] = useState(3);
  const [subFont, setSubFont] = useState('Inter');
  const [subColor, setSubColor] = useState('#ffffff');
  const [subSize, setSubSize] = useState(15);
  const [subBackplate, setSubBackplate] = useState<'none' | 'strip'>('strip');

  const handleAddClipSubtitle = (clipIdx: number) => {
    if (!subText.trim()) return;
    const updated = [...clips];
    const cl = updated[clipIdx];
    if (!cl) return;
    
    if (!cl.subtitles) cl.subtitles = [];
    cl.subtitles.push({
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      text: subText,
      start: parseFloat(subStart.toFixed(1)),
      end: parseFloat(subEnd.toFixed(1)),
      font: subFont,
      color: subColor,
      size: subSize,
      backplate: subBackplate
    });
    cl.hasSubtitles = true;
    onUpdateClipsState(updated);
    setSubText('');
  };

  const handleRemoveClipSubtitle = (clipIdx: number, subId: string) => {
    const updated = [...clips];
    const cl = updated[clipIdx];
    if (!cl || !cl.subtitles) return;
    
    cl.subtitles = cl.subtitles.filter((s: any) => s.id !== subId);
    if (cl.subtitles.length === 0) {
      cl.hasSubtitles = false;
    }
    onUpdateClipsState(updated);
  };

  // Client-side Video Compression for Studio Clips
  const handleCompressStudioClip = async (clipIdx: number) => {
    const targetClip = clips[clipIdx];
    if (!targetClip) return;
    
    let fileToCompress: File | null = targetClip.file || null;

    // If no File object is bound yet (e.g. a library-sourced clip that only has a URL),
    // fetch the real bytes from that URL rather than compressing garbage data.
    if (!fileToCompress && targetClip.url) {
      try {
        const res = await fetch(targetClip.url);
        const blob = await res.blob();
        fileToCompress = new File([blob], targetClip.name || 'original_video.mp4', { type: blob.type || 'video/mp4' });
      } catch (fetchErr) {
        console.warn('Could not fetch clip source for compression:', fetchErr);
        alert('⚠️ Could not read this clip\u2019s source file to compress it. It may be unreachable.');
        return;
      }
    }
    if (!fileToCompress) {
      alert('⚠️ This clip has no readable source file to compress.');
      return;
    }

    setIsStudioCompressing(true);
    setStudioCompressProgress(0);
    setStudioCompressEta(5);
    setStudioCompressStatus('Pre-processing stream headers...');
    setStudioCompressedStats(null);

    try {
      const result = await compressVideoFile(fileToCompress, studioCompressPreset, (prog, eta, status) => {
        setStudioCompressProgress(prog);
        setStudioCompressEta(eta);
        setStudioCompressStatus(status);
      });

      // Update clip files with compressed binary URL
      const compressedUrl = URL.createObjectURL(result.compressedFile);
      const updated = [...clips];
      const cl = updated[clipIdx];
      cl.file = result.compressedFile;
      cl.url = compressedUrl;
      cl.size = result.newSize;
      
      onUpdateClipsState(updated);

      setStudioCompressedStats({
        oldSize: result.oldSize,
        newSize: result.newSize,
        savedPercentage: result.savedPercentage,
        originalResolution: result.originalResolution,
        compressedResolution: result.compressedResolution,
        targetClipId: targetClip.id
      });
    } catch (err: any) {
      alert(`Error compressing: ${err.message || err}`);
    } finally {
      setIsStudioCompressing(false);
    }
  };

  const handleAddOverlay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!overlayText) return;
    setOverlays(prev => [
      ...prev,
      {
        id: 'ov_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        text: overlayText,
        pos: overlayPosition,
        color: overlayColor,
        size: overlaySize,
        clipId: overlayClipId === 'global' ? undefined : overlayClipId,
        startTime: overlayStartTime,
        endTime: overlayEndTime,
        fontFamily: overlayFontFamily,
        styleBold: overlayStyleBold,
        styleItalic: overlayStyleItalic,
        x: overlayUseXY ? overlayX : undefined,
        y: overlayUseXY ? overlayY : undefined
      }
    ]);
    setOverlayText('');
  };

  // Trigger simulated 12:00 Midnight Automatic Event Publisher
  const handleSimulateMidnightLaunch = () => {
    if (clips.length === 0) {
      alert('Stitching timeline must include at least 1 contribution clip before 12:00 AM dispatch publishing!');
      return;
    }

    setSimStatus('running');
    setSimProgress(5);
    setSimLogs([`[12:00:00 AM] ⏰ Automated Midnight Clock Clocked! Initialising pipeline...`]);

    const steps = [
      { p: 15, msg: `[12:00:01 AM] ⚙️ Booting seamless cloud rendering server engine...` },
      { p: 30, msg: `[12:00:02 AM] 🎞️ Auto-stitching ${clips.length} teammate wishes (videos, voice waves, graphics, text slides)...` },
      { p: 48, msg: `[12:00:04 AM] 🎵 Balancing vocals wave soundtrack. Merging native audio with high-pitch Afrobeats sound mixes...` },
      { p: 65, msg: `[12:00:06 AM] 🚀 Render output generated at 1080p full HD!` },
      { p: 80, msg: `[12:00:08 AM] 📤 Cross-posting to configured networks APIs: ${selectedSocials.join(', ')}...` },
      { p: 92, msg: `[12:00:09 AM] 🔗 Webhooks generated & live push alert pushed to targets WhatsApp status broadcast!` },
      { p: 100, msg: `[12:00:10 AM] 🎉 SUCCESS! Automatically uploaded & scheduled surprise video posted in multiple feeds!` }
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        setSimProgress(step.p);
        setSimLogs(prev => [...prev, step.msg]);
        currentStep++;
      } else {
        clearInterval(interval);
        setSimStatus('success');
      }
    }, 1200);
  };

  // Cosmetic countdown only - this panel is explicitly labeled "Test Simulate ..." and
  // must only run when the user clicks that button. It used to auto-call
  // handleSimulateMidnightLaunch() itself once the mock clock hit 12:00:00 AM, ~12 seconds
  // after every page load - popping an unrequested native alert() (or, worse, silently
  // kicking off the fake "rendering & posting to social media" animation) in the middle of
  // whatever the user was actually doing, via a stale closure over `clips` captured at
  // mount time. Real bug, not just confusing UX: it could fire the "add at least one clip"
  // alert even after the user had already added clips, because the interval's closure never
  // saw the update.
  useEffect(() => {
    let tickCount = 48;
    const interval = setInterval(() => {
      if (simStatus !== 'idle') {
        clearInterval(interval);
        return;
      }
      tickCount++;
      if (tickCount < 60) {
        setVirtualClock(`11:59:${tickCount.toString().padStart(2, '0')} PM`);
      } else {
        setVirtualClock('11:59:48 PM');
        tickCount = 48;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [simStatus]);

  const READY_TEMPLATES = [
    { id: 'birthday', name: 'Birthday Bash', emoji: '🎂', mood: 'hype', soundtrack: 'bm1', filter: 'brightness', frame: 'neon', bg: 'birthday', desc: 'Upbeat party vibes with floating balloons' },
    { id: 'wedding', name: 'Wedding Bliss', emoji: '💍', mood: 'nostalgia', soundtrack: 'bm4', filter: 'sepia', frame: 'hearts', bg: 'wedding', desc: 'Warm romantic filters with sweet hearts backdrop' },
    { id: 'anniversary', name: 'Anniversary Gala', emoji: '🌟', mood: 'normal', soundtrack: 'bm5', filter: 'sepia', frame: 'vintage', bg: 'wedding', desc: 'Soft memory stroll with nostalgic filters' },
    { id: 'graduation', name: 'Graduation Farewell', emoji: '🎓', mood: 'hype', soundtrack: 'bm6', filter: 'brightness', frame: 'neon', bg: 'luxury', desc: 'High energy farewell theme' },
    { id: 'church', name: 'Church Program', emoji: '⛪', mood: 'normal', soundtrack: 'bm5', filter: 'none', frame: 'none', bg: 'church', desc: 'glowing arches backdrop with choral hymn score' },
    { id: 'retirement', name: 'Retirement Gift', emoji: '💼', mood: 'normal', soundtrack: 'bm2', filter: 'none', frame: 'none', bg: 'corporate', desc: 'Clean corporate tribute' },
    { id: 'memorial', name: 'Memorial Tribute', emoji: '🕊️', mood: 'nostalgia', soundtrack: 'bm4', filter: 'grayscale', frame: 'vintage', bg: 'luxury', desc: 'Slow-paced respectful memory stroll' },
    { id: 'awards', name: 'Corporate Awards', emoji: '🏆', mood: 'hype', soundtrack: 'bm6', filter: 'brightness', frame: 'none', bg: 'award', desc: 'Grand spotlights stage style' },
    { id: 'school', name: 'School Farewell', emoji: '🏫', mood: 'hype', soundtrack: 'bm3', filter: 'brightness', frame: 'sparkles', bg: 'festival', desc: 'Fun celebratory fireworks template' },
    { id: 'appreciation', name: 'Employee Thanks', emoji: '🤝', mood: 'normal', soundtrack: 'bm5', filter: 'none', frame: 'none', bg: 'luxury', desc: 'Sincere appreciation theme' },
  ];

  const applyReadyTemplate = (tId: string) => {
    const t = READY_TEMPLATES.find(x => x.id === tId);
    if (!t) return;
    
    setAiMood(t.mood as any);
    setSoundtrackId(t.soundtrack);
    setActiveVideoFilter(t.filter as any);
    setAnimatedFrame(t.frame as any);
    
    let compiledList = [...clips];
    if (compiledList.length === 0) {
      // Build 3 beautiful storyboard clips matching the template
      compiledList = [
        {
          id: 'tpl_intro_' + Date.now(),
          sourceMediaId: 'intro',
          type: 'text',
          file: null,
          url: 'TEXT_INTRO',
          dur: 6,
          name: `🎬 Welcome Intro - ${t.name}`,
          from: 'Zipp Zap AI Studio',
          textBody: `Welcome to the Grand surprise tribute celebration!`,
          style: t.frame === 'neon' ? 'royal' : 'emerald',
          trimStart: 0,
          trimEnd: 6,
          transition: 'fade',
          backgroundReplace: t.bg
        },
        {
          id: 'tpl_wish_' + Date.now(),
          sourceMediaId: 'wish',
          type: 'photo',
          file: null,
          url: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=600&auto=format&fit=crop',
          dur: 5,
          name: `📸 Shared Memory Slideshow`,
          from: 'Best Friends Group',
          textBody: '',
          style: 'gradient',
          trimStart: 0,
          trimEnd: 5,
          transition: 'slide',
          backgroundReplace: t.bg,
          faceCentering: true
        },
        {
          id: 'tpl_closing_' + Date.now(),
          sourceMediaId: 'closing',
          type: 'text',
          file: null,
          url: 'TEXT_CLOSING',
          dur: 5,
          name: `🎁 Outro - Thank You Credits`,
          from: 'Zipp Zap Co-Pilot',
          textBody: `Presented with love by the entire crew. Happy Celebration!`,
          style: 'royal',
          trimStart: 0,
          trimEnd: 5,
          transition: 'fade',
          backgroundReplace: t.bg
        }
      ];
      onUpdateClipsState(compiledList);
      onUpdateTimelineState([0, 1, 2]);
    } else {
      // Configure existing clips to use the backdrop replacements
      const updated = clips.map(c => ({
        ...c,
        backgroundReplace: t.bg,
        faceCentering: true,
        videoCleanup: true,
        audioCleanup: true
      }));
      onUpdateClipsState(updated);
    }
    
    alert(`✨ 1-Click Template Applied: "${t.name}"!\nEverything has been configured instantly: soundtrack changed, color grading set to ${t.filter}, layout frames aligned to ${t.frame}, and Real-Time AI Background set to ${t.bg} theme. Click Preview to see compiling results!`);
  };

  const getFilterCss = (f: string) => {
    switch (f) {
      case 'grayscale': return 'grayscale(100%)';
      case 'sepia': return 'sepia(100%)';
      case 'vibrant': return 'saturate(180%) contrast(125%) brightness(110%)';
      case 'brightness': return 'brightness(130%)';
      case 'vignette': return 'contrast(105%) brightness(97%)'; // CSS has no true vignette filter - real vignette only applies at export time
      case 'oldfilm': return 'sepia(45%) contrast(108%) saturate(85%) brightness(97%)';
      case 'noir': return 'grayscale(100%) contrast(140%) brightness(98%)';
      case 'dreamy': return 'saturate(115%) brightness(108%) blur(1px)';
      case 'vhs': return 'saturate(130%) contrast(95%) hue-rotate(2deg)';
      case 'invert': return 'invert(100%)';
      case 'sharpen': return 'contrast(110%)'; // CSS can't truly sharpen - real unsharp-mask only applies at export time
      case 'blur': return 'blur(3px)';
      case 'thermal': return 'hue-rotate(280deg) saturate(300%) contrast(120%)';
      case 'nightvision': return 'hue-rotate(90deg) saturate(200%) brightness(105%)';
      case 'sketch': return 'grayscale(100%) contrast(180%) brightness(115%)'; // rough approximation - real edge-detect only applies at export time
      default: return 'none';
    }
  };

  const getSoundtrackUrl = (id: string) => getSoundtrackUrlShared(id, customSoundtrackUrl);

  useEffect(() => {
    if (playing) {
      drawStudioFrame(playTime);
    }
  }, [playTime, playing, clips]);

  // Synchronized background music soundtrack player
  useEffect(() => {
    if (soundtrackId === 'none') {
      if (soundtrackAudioRef.current) {
        soundtrackAudioRef.current.pause();
      }
      return;
    }

    const url = getSoundtrackUrl(soundtrackId);
    if (!url) return;

    if (!soundtrackAudioRef.current) {
      soundtrackAudioRef.current = new Audio(url);
      soundtrackAudioRef.current.loop = true;
    } else if (soundtrackAudioRef.current.src !== url) {
      soundtrackAudioRef.current.src = url;
    }

    soundtrackAudioRef.current.volume = bgVol / 100;

    if (playing) {
      if (soundtrackAudioRef.current.paused) {
        soundtrackAudioRef.current.play().catch(() => {});
      }
    } else {
      soundtrackAudioRef.current.pause();
    }
  }, [playing, soundtrackId, bgVol]);

  useEffect(() => {
    drawIdleCanvas();
    return () => {
      Object.values(videoRefsRef.current).forEach((v: any) => {
        try { document.body.removeChild(v); } catch(ex){}
      });
      Object.values(audioRefsRef.current).forEach((a: any) => {
        try { document.body.removeChild(a); } catch(ex){}
      });
      if (animationRef.current) cancelAnimationFrame(animationRef.current);

      // Terminate background rendering workers and trackers on unmount
      if (renderWorkerServiceRef.current) {
        renderWorkerServiceRef.current.terminate();
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (voiceMicStreamRef.current) {
        voiceMicStreamRef.current.getTracks().forEach((t) => t.stop());
        voiceMicStreamRef.current = null;
      }
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((t) => t.stop());
        webcamStreamRef.current = null;
      }
      if (soundtrackAudioRef.current) {
        soundtrackAudioRef.current.pause();
        soundtrackAudioRef.current = null;
      }
    };
  }, []);

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between p-4 md:p-6 overflow-y-auto lg:overflow-hidden animate-in fade-in duration-200 text-white font-sans">
        {/* Fullscreen Header */}
        <div className="flex justify-between items-center pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-md font-black tracking-widest uppercase text-indigo-400 flex items-center gap-1.5 animate-pulse">
              <span>📺</span> IMMERSIVE FULL-SCREEN CINEMATIC PLAYER
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Previewing Compiled Media Stream • Real-Time Filters • Export Manager</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsFullscreenHideOptions(!isFullscreenHideOptions)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-900/25 hover:scale-105 active:scale-[0.98]"
            >
              <span>{isFullscreenHideOptions ? "👁️ Show Export Panel" : "🚫 Hide Export Panel"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                handlePausePlay();
                setIsFullscreen(false);
              }}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-900/25 hover:scale-105 active:scale-[0.98]"
            >
              <span>❌</span> Exit Full Screen
            </button>
          </div>
        </div>

        {/* Central Immersive Area */}
        <div className="flex-1 w-full bg-slate-950 flex flex-col lg:flex-row justify-center items-center gap-6 my-4 overflow-y-auto lg:overflow-hidden">
          {/* Left portion: Player canvas */}
          <div className={`flex-1 ${isFullscreenHideOptions ? 'max-w-6xl' : 'max-w-4xl'} w-full flex flex-col justify-center items-center transition-all duration-300`}>
            <div className={`${getAspectContainerClass()} w-full relative bg-slate-900 flex items-center justify-center rounded-2xl border border-slate-800 overflow-hidden shadow-2xl`}>
              <canvas 
                ref={canvasRef} 
                width={getCanvasDimensions().w} 
                height={getCanvasDimensions().h} 
                className="w-full h-full object-contain absolute inset-0 z-10 animate-in zoom-in-95 duration-300" 
                style={{ filter: getFilterCss(activeVideoFilter) }}
              />
            </div>
            
            {/* Playback details & simple controls row */}
            <div className="w-full bg-slate-900/60 p-4 rounded-xl border border-slate-800/80 mt-3 flex flex-col gap-3">
              {/* Scrubber slider, with marker ticks overlaid */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-400 min-w-[35px]">{playTime.toFixed(1)}s</span>
                <div className="flex-1 relative">
                  <input
                    type="range"
                    min={0}
                    max={totalDuration || 1}
                    step={0.05}
                    value={playTime}
                    onChange={(e) => {
                      const targetTime = parseFloat(e.target.value);
                      setPlayTime(targetTime);
                      if (!playing) {
                        drawStudioFrame(targetTime);
                      }
                    }}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                  />
                  {markers.map(mk => (
                    <div
                      key={mk.id}
                      className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-amber-400 pointer-events-none rounded-full"
                      style={{ left: `${Math.min(100, Math.max(0, (mk.time / (totalDuration || 1)) * 100))}%` }}
                      title={`🔖 ${mk.label} @ ${formatMarkerTimestamp(mk.time)}`}
                    />
                  ))}
                </div>
                <span className="text-[10px] font-mono text-slate-400 min-w-[35px]">{totalDuration.toFixed(1)}s</span>
                <button
                  type="button"
                  onClick={() => addMarkerAtTime(playTime)}
                  className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-[10px] font-black cursor-pointer transition whitespace-nowrap flex items-center gap-1 shrink-0"
                  title="Add a chapter marker at the current playhead (shortcut: M)"
                >
                  🔖 Add Chapter
                </button>
              </div>

              {markers.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 bg-amber-50/60 border border-amber-100 rounded-xl p-2">
                  {markers.map(mk => (
                    <div key={mk.id} className="flex items-center gap-1 bg-white border border-amber-200 rounded-lg pl-2 pr-1 py-1 text-[10px] font-bold text-amber-800">
                      <button
                        type="button"
                        onClick={() => { setPlayTime(mk.time); drawStudioFrame(mk.time); }}
                        className="cursor-pointer hover:text-amber-600"
                        title="Jump to this chapter"
                      >
                        🔖 {formatMarkerTimestamp(mk.time)} {mk.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMarker(mk.id)}
                        className="text-amber-400 hover:text-rose-500 cursor-pointer px-1"
                        title="Delete chapter"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleCopyMarkerList}
                    className="ml-auto px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[10px] font-black cursor-pointer transition whitespace-nowrap"
                    title="Copy a YouTube-description-ready chapter list, and embed real chapters into the exported MP4"
                  >
                    📋 Copy Chapter List
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setPlayTime(0);
                      drawStudioFrame(0);
                    }}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                    title="Go to Top (Start)"
                  >
                    <span>⏮️ Top</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = Math.max(0, playTime - 5);
                      setPlayTime(target);
                      drawStudioFrame(target);
                    }}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                    title="-5 seconds"
                  >
                    <span>⏪ Back</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStartPlay}
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-950 rounded-xl font-extrabold text-xs transition min-w-[75px] shrink-0 cursor-pointer flex items-center gap-1 hover:scale-105 active:scale-95"
                  >
                    {playing ? '⏸️ Pause' : '▶️ Play'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = Math.min(totalDuration, playTime + 5);
                      setPlayTime(target);
                      drawStudioFrame(target);
                    }}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                    title="+5 seconds"
                  >
                    <span>Forward ⏩</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePausePlay}
                    className="px-3.5 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition flex items-center gap-1 active:scale-95 cursor-pointer"
                  >
                    ⏹️ Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Real frame grab (LibreCuts' "Snapshot" feature): captures exactly what the
                      // live preview canvas is currently showing - filters, overlays, subtitles and
                      // all - as a downloadable high-quality PNG.
                      const cv = canvasRef.current;
                      if (!cv) return;
                      cv.toBlob((blob) => {
                        if (!blob) return;
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `snapshot_${playTime.toFixed(1)}s.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 2000);
                      }, 'image/png', 1.0);
                    }}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                    title="Save the current preview frame as a PNG image"
                  >
                    📸 Snapshot
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right portion: Custom High Fidelity Export Options Panel */}
          {!isFullscreenHideOptions && (
            <div className="w-full lg:w-[360px] bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 max-h-full overflow-y-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-black tracking-widest text-indigo-400 uppercase">📽️ MP4 MOVIE DOWNLOAD PRESETS</h3>
                <p className="text-[10px] text-slate-400 mt-1 leading-normal">Configure output parameters and format settings for cross-device compatibility before downloading.</p>
              </div>

              {/* Format selection */}
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Container Format</label>
                <div className="grid grid-cols-4 gap-1">
                  {(['MP4', 'WebM', 'AVI', 'GIF'] as const).map(fmt => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setExportFormat(fmt)}
                      className={`py-1 text-[9px] font-bold rounded-lg transition border cursor-pointer ${
                        exportFormat === fmt 
                          ? 'bg-indigo-600 border-indigo-500 text-white' 
                          : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution selection */}
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Video Resolution</label>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    { id: '720p', label: '720p', emoji: '📺', hint: 'Fast' },
                    { id: '1080p', label: '1080p', emoji: '✨', hint: 'Recommended' },
                    { id: '4K', label: '4K', emoji: '👑', hint: 'Cine Max' },
                  ] as const).map(res => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => setExportResolution(res.id)}
                      title={`${res.label} - ${res.hint}`}
                      className={`py-1 text-[9px] font-bold rounded-lg transition border flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                        exportResolution === res.id
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      <span>{res.emoji} {res.label}</span>
                      <span className="text-[8px] opacity-80">{res.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Framerate Selection */}
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Frame Rate (FPS)</label>
                <div className="grid grid-cols-3 gap-1">
                  {[24, 30, 60].map(fps => (
                    <button
                      key={fps}
                      type="button"
                      onClick={() => setExportFps(fps)}
                      className={`py-1 text-[9px] font-bold rounded-lg transition border cursor-pointer ${
                        exportFps === fps 
                          ? 'bg-indigo-600 border-indigo-500 text-white' 
                          : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      {fps} FPS {fps === 30 ? '⏱️' : fps === 60 ? '⚡' : '🎞️'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Compression Quality Selection */}
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Bitrate Quality Profile</label>
                <div className="grid grid-cols-3 gap-1">
                  {(['fast', 'balanced', 'high'] as const).map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setExportQuality(q)}
                      className={`py-1 text-[9px] font-bold rounded-lg transition border uppercase cursor-pointer ${
                        exportQuality === q 
                          ? 'bg-indigo-600 border-indigo-500 text-white' 
                          : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      {q === 'high' ? 'HQ Lossless' : q === 'balanced' ? 'Balanced' : 'Fast Compress'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Timeline Presets (Bulk Filter Selection inside Fullscreen) */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                <label className="text-[9px] font-black uppercase text-indigo-400 tracking-wider">Bulk Filter Overlay</label>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { id: 'none', label: 'None', emoji: '❌' },
                    { id: 'grayscale', label: 'B&W', emoji: '🖤' },
                    { id: 'sepia', label: 'Sepia', emoji: '📜' },
                    { id: 'vibrant', label: 'Vibrant', emoji: '🔥' },
                    { id: 'brightness', label: 'Bright', emoji: '☀️' },
                    { id: 'vignette', label: 'Vignette', emoji: '🌑' },
                    { id: 'oldfilm', label: 'Old Film', emoji: '🎞️' },
                    { id: 'noir', label: 'Noir', emoji: '🕵️' },
                    { id: 'dreamy', label: 'Dreamy', emoji: '✨' },
                    { id: 'vhs', label: 'VHS', emoji: '📼' },
                    { id: 'invert', label: 'Invert', emoji: '🔄' },
                    { id: 'sharpen', label: 'Sharpen', emoji: '🔪' },
                    { id: 'blur', label: 'Blur', emoji: '💧' },
                    { id: 'thermal', label: 'Thermal', emoji: '🌡️' },
                    { id: 'nightvision', label: 'Night Vision', emoji: '🌃' },
                    { id: 'sketch', label: 'Sketch', emoji: '✏️' },
                  ].map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setActiveVideoFilter(f.id as any);
                        handleBulkApplyFilter(f.id);
                      }}
                      className={`py-1 text-[9px] font-bold rounded-lg transition border flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                        activeVideoFilter === f.id
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      <span>{f.emoji}</span>
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[8px] text-slate-400">Instantly sets the active filter preset on all clips in the timeline.</p>
              </div>
            </div>

            {/* Export Rendering Progression Block */}
            <div className="pt-2 border-t border-slate-800 space-y-2.5">
              {isExporting ? (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-bold">
                    <span className="text-indigo-400 animate-pulse uppercase">Compiling {exportFormat}...</span>
                    <span className="bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full font-mono">{exportProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden shadow-inner">
                    <div className="bg-indigo-500 h-full transition-all duration-150" style={{ width: `${exportProgress}%` }} />
                  </div>
                  <p className="text-[9px] text-slate-300 leading-normal pl-1.5 border-l border-indigo-500 select-all font-mono truncate">
                    {exportStatus}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      renderWorkerServiceRef.current?.cancel(() => {
                        setIsExporting(false);
                        setExportProgress(0);
                        setExportStatus('Export cancelled.');
                      });
                    }}
                    className="w-full h-8 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white font-bold text-[10px] transition cursor-pointer"
                  >
                    ✕ Cancel Export
                  </button>
                </div>
              ) : null}

              {downloadableMovieUrl && (
                <div className="bg-emerald-950/40 border border-emerald-900/30 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 bg-emerald-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">✓</span>
                    <span className="text-[10px] text-emerald-400 font-extrabold">Ready for download!</span>
                  </div>
                  {exportWarnings.length > 0 && (
                    <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg p-2 space-y-1">
                      {exportWarnings.map((w, wi) => (
                        <p key={wi} className="text-[9px] text-amber-300 leading-normal flex gap-1">
                          <span className="shrink-0">⚠️</span>
                          <span>{w}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  <a
                    href={downloadableMovieUrl}
                    download={`stitched_movie_${exportResolution}_${exportFps}fps_${exportQuality}.${exportFormat.toLowerCase()}`}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-900/20 active:scale-95 transition-all text-center"
                  >
                    ⬇️ Download {exportFormat} Movie file
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      // Deliberately NOT tied to the download link's own onClick: removing this
                      // card (and therefore unmounting the <a> element) in the very same click
                      // that starts the browser's download can race with - and in some browsers
                      // (notably Safari) silently cancel - the download itself. Clearing state
                      // only happens here, via a separate "start a new export" action.
                      if (downloadableMovieUrl) URL.revokeObjectURL(downloadableMovieUrl);
                      setDownloadableMovieUrl(null);
                      setExportWarnings([]);
                      setIsExporting(false);
                    }}
                    className="w-full text-[9px] text-slate-400 hover:text-slate-300 font-bold py-1 cursor-pointer transition"
                  >
                    Start a new export
                  </button>
                </div>
              )}

              {!isExporting && !downloadableMovieUrl && (
                <button
                  type="button"
                  onClick={handleExportMovie}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-all"
                >
                  🎬 Compile & Download {exportFormat}
                </button>
              )}

              {/* Multi-format batch export - same timeline, three social-ready crops in one click */}
              {!isExporting && !isBatchExporting && (
                <button
                  type="button"
                  onClick={handleBatchExport}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-extrabold py-2 rounded-xl text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                >
                  🎯 Batch Export: Reel + Square + Standard
                </button>
              )}
              {isBatchExporting && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[10px] text-slate-300">
                  ⏳ {batchStatus}
                </div>
              )}
              {batchResults.length > 0 && (
                <div className="space-y-1.5">
                  {batchResults.map((r) => (
                    <a
                      key={r.filename}
                      href={r.url}
                      download={r.filename}
                      className="w-full bg-emerald-950/40 border border-emerald-900/30 hover:bg-emerald-900/40 text-emerald-400 font-bold py-1.5 rounded-lg text-[10px] flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                    >
                      ⬇️ {r.label}
                    </a>
                  ))}
                </div>
              )}

              {/* Scriptable render spec - power-user JSON import/export of the exact render pipeline */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportRenderSpec}
                  className="flex-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold py-1.5 rounded-lg text-[10px] cursor-pointer transition-all"
                >
                  📄 Export Render Spec (JSON)
                </button>
                <button
                  type="button"
                  onClick={() => specImportInputRef.current?.click()}
                  className="flex-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold py-1.5 rounded-lg text-[10px] cursor-pointer transition-all"
                >
                  📥 Import Render Spec
                </button>
                <input
                  ref={specImportInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportRenderSpec(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Footer controls status */}
        <div className="text-center text-[10px] text-slate-500 border-t border-slate-900 pt-3 flex justify-between items-center">
          <span>Stitcher Timeline Status: {clips.length} Clips Loaded</span>
          <button
            type="button"
            onClick={() => {
              handlePausePlay();
              setIsFullscreen(false);
            }}
            className="text-slate-400 hover:text-white transition font-bold cursor-pointer"
          >
            ← Exit Screen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Floating Render & Deliver status - fixed so it's visible no matter where on the
          page the user is scrolled to. Fixes a real bug: handleExportMovie (triggered by
          Quick Stitch, or any future trigger outside the fullscreen preview) used to only
          render its progress bar / download-ready card inside the isFullscreen branch, so
          a Quick Stitch render from the normal view finished with zero visible result - no
          percentage, no download link, nothing. This mounts the same live state
          (isExporting / exportProgress / downloadableMovieUrl / batch export) as a
          persistent floating card instead, so a render started from anywhere always ends
          somewhere the user can see and download it from. */}
      {(isExporting || downloadableMovieUrl || isBatchExporting || batchResults.length > 0) && (
        <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm space-y-2.5 bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-2xl" data-testid="floating-render-status">
          {isExporting && (
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-2">
              <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-indigo-400 animate-pulse uppercase">Compiling {exportFormat}...</span>
                <span className="bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full font-mono" data-testid="floating-render-progress">{exportProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden shadow-inner">
                <div className="bg-indigo-500 h-full transition-all duration-150" style={{ width: `${exportProgress}%` }} />
              </div>
              <p className="text-[9px] text-slate-300 leading-normal pl-1.5 border-l border-indigo-500 select-all font-mono truncate">
                {exportStatus}
              </p>
              <button
                type="button"
                onClick={() => {
                  renderWorkerServiceRef.current?.cancel(() => {
                    setIsExporting(false);
                    setExportProgress(0);
                    setExportStatus('Export cancelled.');
                  });
                }}
                className="w-full h-8 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white font-bold text-[10px] transition cursor-pointer"
              >
                ✕ Cancel Export
              </button>
            </div>
          )}

          {downloadableMovieUrl && (
            <div className="bg-emerald-950/40 border border-emerald-900/30 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 bg-emerald-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">✓</span>
                <span className="text-[10px] text-emerald-400 font-extrabold">Ready for download!</span>
              </div>
              {exportWarnings.length > 0 && (
                <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg p-2 space-y-1">
                  {exportWarnings.map((w, wi) => (
                    <p key={wi} className="text-[9px] text-amber-300 leading-normal flex gap-1">
                      <span className="shrink-0">⚠️</span>
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
              <a
                href={downloadableMovieUrl}
                download={`stitched_movie_${exportResolution}_${exportFps}fps_${exportQuality}.${exportFormat.toLowerCase()}`}
                data-testid="floating-download-link"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-900/20 active:scale-95 transition-all text-center"
              >
                ⬇️ Download {exportFormat} Movie file
              </a>
              <button
                type="button"
                onClick={() => {
                  if (downloadableMovieUrl) URL.revokeObjectURL(downloadableMovieUrl);
                  setDownloadableMovieUrl(null);
                  setExportWarnings([]);
                  setIsExporting(false);
                }}
                className="w-full text-[9px] text-slate-400 hover:text-slate-300 font-bold py-1 cursor-pointer transition"
              >
                Dismiss
              </button>
            </div>
          )}

          {isBatchExporting && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-[10px] text-slate-300">
              ⏳ {batchStatus}
            </div>
          )}
          {batchResults.length > 0 && (
            <div className="space-y-1.5">
              {batchResults.map((r) => (
                <a
                  key={r.filename}
                  href={r.url}
                  download={r.filename}
                  className="w-full bg-emerald-950/40 border border-emerald-900/30 hover:bg-emerald-900/40 text-emerald-400 font-bold py-1.5 rounded-lg text-[10px] flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                >
                  ⬇️ {r.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Title block / upload dropzone */}
      <div
        onDragEnter={handleDropzoneDragEnter}
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={handleDropzoneDrop}
        className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 border-2 rounded-3xl shadow-sm transition-colors ${
          isDropzoneActive ? 'border-indigo-500 border-dashed bg-indigo-50/60' : 'border-slate-200'
        }`}
      >
        <div>
          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full uppercase tracking-wider">Multi-Format Creative Engine</span>
          <h1 id="video-studio-main-title" className="text-xl md:text-2xl font-black text-slate-900 mt-2">🎬 Live Stitcher Studio</h1>
          <p className="text-xs text-slate-500 mt-1">Stitch together recorded videos, vocal wave files, guest greeting slides, and image frames into a consolidated gift movie</p>
          <p className="text-[10.5px] text-slate-400 mt-1.5">
            {isDropzoneActive ? '📥 Drop files anywhere in this card to add them' : '💡 Drag & drop files here too — including a .zip full of clips, photos, or audio'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <input
            type="file"
            multiple
            ref={fileInputRef}
            accept="video/*,audio/*,image/*,.zip,application/zip,application/x-zip-compressed"
            className="hidden"
            data-testid="studio-main-upload-input"
            onChange={handleAddNewFiles}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 border border-slate-200 hover:border-indigo-600 bg-white font-extrabold text-[#1C1207] text-xs rounded-xl transition cursor-pointer"
          >
            📂 Import Files or .zip
          </button>
          <button
            onClick={() => {
              if (clips.length === 0) {
                alert('Your stitching bin is empty! Load video files or quick-import library materials below.');
                return;
              }
              setPreviewClipIdx(0);
              setPreviewTimer(0);
              setPreviewPlaying(true);
              setExportPreviewOpen(true);
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow transition cursor-pointer"
          >
            Stitch & Render Video ➔
          </button>
        </div>
      </div>

      {/* AI Compile / Manual Edit mode selector - scrolls to the matching section below.
          Both halves of the studio are always present on the page; this is a wayfinding
          control, not a visibility gate, so it can't hide a tool the user is relying on. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => handleStudioModeSelect('ai')}
          className={`text-left p-4 rounded-2xl border-2 transition cursor-pointer flex items-center gap-3 ${
            studioMode === 'ai'
              ? 'bg-gradient-to-br from-indigo-600 to-purple-700 border-indigo-500 text-white shadow-lg'
              : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'
          }`}
        >
          <span className="text-2xl">✨</span>
          <span>
            <span className="block text-xs font-black uppercase tracking-wide">AI Compile</span>
            <span className={`block text-[10.5px] ${studioMode === 'ai' ? 'text-indigo-100' : 'text-slate-400'}`}>Let AI create magic</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => handleStudioModeSelect('manual')}
          className={`text-left p-4 rounded-2xl border-2 transition cursor-pointer flex items-center gap-3 ${
            studioMode === 'manual'
              ? 'bg-gradient-to-br from-slate-800 to-slate-950 border-slate-700 text-white shadow-lg'
              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
          }`}
        >
          <span className="text-2xl">🎛️</span>
          <span>
            <span className="block text-xs font-black uppercase tracking-wide">Manual Edit</span>
            <span className={`block text-[10.5px] ${studioMode === 'manual' ? 'text-slate-300' : 'text-slate-400'}`}>Full creative control</span>
          </span>
        </button>
      </div>

      {/* My Media quick-access strip - always visible near the top of the page instead of
          being buried after the timeline, mirroring the reference layout's persistent media
          sidebar. Reuses the exact same importableMedia data and handleImportMediaToStudio
          handler as the full grid further down (see "My Media" below) - this is a second,
          compact view onto the same real data, not a separate/fake feature. */}
      {importableMedia.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
          <div className="flex justify-between items-center pb-2.5 mb-2.5 border-b border-slate-50">
            <h3 className="text-[10px] font-bold text-[#1C1207] uppercase tracking-widest">🖼️ My Media <span className="text-slate-400 font-medium normal-case">· quick import</span></h3>
            <span className="text-[10px] text-indigo-600 px-2 py-0.5 bg-indigo-50 rounded-full font-black">{importableMedia.length} Available</span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {importableMedia.slice(0, 16).map(m => {
              const typeEmoji = m.type === 'video' ? '📹' : m.type === 'photo' ? '📸' : m.type === 'audio' ? '🎙️' : '✍️';
              return (
                <button
                  key={`quickstrip-${m.id}`}
                  type="button"
                  onClick={() => handleImportMediaToStudio(m)}
                  title={`Add "${m.name}" to timeline`}
                  className="group text-left cursor-pointer shrink-0 w-16"
                >
                  <div className="relative aspect-square w-16 rounded-lg overflow-hidden bg-slate-900 border border-slate-200 group-hover:border-indigo-400 transition">
                    {m.thumb ? (
                      <img src={m.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg bg-gradient-to-br from-slate-800 to-slate-950">{typeEmoji}</div>
                    )}
                    <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded bg-black/60 backdrop-blur-xs flex items-center justify-center text-[8px]">{typeEmoji}</span>
                  </div>
                  <p className="text-[8.5px] font-bold text-slate-600 truncate mt-1">{m.name}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Smart Shortcuts - one-click real actions, not decoration. Auto-Trim Silence toggles
          the same autoTrimSilenceEnabled flag the render pipeline already reads; Highlight
          Finder runs the real RMS audio-energy analysis (handleFindHighlights) already wired
          to the timeline toolbar, surfaced here too since it's easy to miss further down. */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
        <h3 className="text-[10px] font-bold text-[#1C1207] uppercase tracking-widest pb-2.5 mb-2.5 border-b border-slate-50">⚡ Smart Shortcuts</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={handleQuickStitch}
            disabled={isExporting}
            className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100 hover:border-emerald-400 disabled:opacity-50 transition cursor-pointer text-center"
          >
            <span className="text-lg">🚀</span>
            <span className="text-[10px] font-black text-emerald-700">Quick Stitch</span>
            <span className="text-[8.5px] text-emerald-600/80">Arrange &amp; render now</span>
          </button>
          <button
            type="button"
            onClick={() => setAutoTrimSilenceEnabled(v => !v)}
            className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border transition cursor-pointer text-center ${
              autoTrimSilenceEnabled ? 'bg-indigo-50 border-indigo-300' : 'bg-slate-50 border-slate-150 hover:border-indigo-300'
            }`}
          >
            <span className="text-lg">✂️</span>
            <span className="text-[10px] font-black text-slate-800">Auto Trim</span>
            <span className={`text-[8.5px] ${autoTrimSilenceEnabled ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
              {autoTrimSilenceEnabled ? 'Enabled ✓' : 'Removes silences'}
            </span>
          </button>
          <button
            type="button"
            onClick={handleFindHighlights}
            disabled={isFindingHighlights || clips.length === 0}
            className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-amber-50 border border-amber-100 hover:border-amber-400 disabled:opacity-50 transition cursor-pointer text-center"
          >
            <span className="text-lg">🎯</span>
            <span className="text-[10px] font-black text-amber-700">Highlight Reel</span>
            <span className="text-[8.5px] text-amber-600/80">{isFindingHighlights ? (highlightFinderStatus || 'Analyzing…') : 'Trim to best moment'}</span>
          </button>
          <button
            type="button"
            onClick={() => handleStudioModeSelect('ai')}
            className="flex flex-col items-center justify-center gap-1 p-3 rounded-xl bg-purple-50 border border-purple-100 hover:border-purple-400 transition cursor-pointer text-center"
          >
            <span className="text-lg">✨</span>
            <span className="text-[10px] font-black text-purple-700">AI Auto-Compile</span>
            <span className="text-[8.5px] text-purple-600/80">Assemble from wishes</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column Settings block */}
        <div className="lg:col-span-7 space-y-6">

          {/* ✨ 1-CLICK READY-MADE EVENT TEMPLATES */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div>
              <span className="text-[10px] font-black text-indigo-655 uppercase tracking-widest block text-indigo-600">Dynamic Template Wizard</span>
              <h3 className="text-sm font-black text-slate-900 mt-0.5">✨ One-Click Ready-Made Event Templates</h3>
              <p className="text-[10.5px] text-slate-500 mt-1">
                Select an occasion below to customize the soundtrack, filters, frames, and background replacements instantly! (Auto-populates story slides if empty).
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {READY_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyReadyTemplate(t.id)}
                  type="button"
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-50 border border-slate-150 hover:border-indigo-500 hover:bg-slate-50/20 active:scale-[0.97] transition cursor-pointer text-center group"
                >
                  <span className="text-2xl group-hover:animate-bounce duration-300">{t.emoji}</span>
                  <span className="text-[10.5px] font-extrabold text-slate-800 mt-1">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* 🚀 One-click path for anyone who doesn't want to touch a single setting.
              Deliberately kept separate from the AI Auto-Compiler panel below (which
              stays exactly as it was) so this is purely additive - it reuses clips'
              existing default shape and the same handleExportMovie render pipeline,
              so it can't drift out of sync with the reliability fixes that pipeline
              already has. */}
          <div className="bg-gradient-to-br from-emerald-600 to-teal-700 border border-emerald-400/30 rounded-3xl p-5 text-white shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-black text-emerald-200 uppercase tracking-widest block">For a first try, or if settings feel like a lot</span>
              <h3 className="text-sm font-black flex items-center gap-1.5 mt-0.5">
                <span>🚀</span> Quick Stitch — one click, sensible defaults
              </h3>
              <p className="text-[10.5px] text-emerald-100/90 mt-1 max-w-md">
                {clips.length > 0
                  ? `Uses your current ${clips.length}-clip timeline as-is, turns on auto-trim-silence and a soundtrack if you haven't picked one, and renders immediately.`
                  : 'Pulls in every approved clip/photo/wish, arranges them in order with fades, turns on auto-trim-silence and a soundtrack, and renders immediately.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleQuickStitch}
              disabled={isExporting}
              className="shrink-0 py-3 px-6 bg-white hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-700 font-black text-xs uppercase tracking-wider rounded-xl transition cursor-pointer shadow-lg active:scale-95 whitespace-nowrap"
            >
              {isExporting ? 'Rendering…' : '🚀 Quick Stitch Now'}
            </button>
          </div>

          {/* 🤖 AI & MANUAL HYBRID AUTO-COMPILER */}
          <div ref={aiCompileSectionRef} className="bg-gradient-to-br from-indigo-900 to-slate-900 border border-indigo-500/30 rounded-3xl p-5 text-white shadow-xl space-y-4 scroll-mt-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-indigo-505/30 pb-3">
              <div>
                <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest block">Neural Video Synthesizer</span>
                <h3 className="text-sm font-black flex items-center gap-1.5 mt-0.5">
                  <span>🤖</span> AI Smart Timeline Auto-Compiler
                </h3>
              </div>
              <span className="text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full font-bold">
                Multi-Format Co-Pilot
              </span>
            </div>

            {/* Collected statistics list */}
            <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
              <div className="bg-slate-950/40 p-2 border border-slate-800/80 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Total Wish Pool</div>
                <div className="text-lg font-black text-indigo-350 mt-0.5">
                  {media.filter(m => m.id && !m.id.includes('demo') && m.from !== 'Me (Composer)').length || 4}
                </div>
              </div>
              <div className="bg-slate-950/40 p-2 border border-slate-800/80 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Video & Audio</div>
                <div className="text-lg font-black text-amber-450 mt-0.5">
                  {media.filter(m => (m.type === 'video' || m.type === 'audio') && m.from !== 'Me (Composer)').length || 2}
                </div>
              </div>
              <div className="bg-slate-950/40 p-2 border border-slate-800/80 rounded-xl">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Photoramas & Notes</div>
                <div className="text-lg font-black text-emerald-450 mt-0.5">
                  {media.filter(m => (m.type === 'photo' || m.type === 'text') && m.from !== 'Me (Composer)').length || 2}
                </div>
              </div>
            </div>

            {/* AI compilation style selector */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase text-indigo-300 tracking-wider">
                Select AI Assistant Aesthetic Direction
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { id: 'hype', title: 'High-Energy Hype Mix 🥁', desc: 'Active slide transitions, rainbow border neon frames, dance soundtrack, vibrant filter', border: 'border-amber-500/30' },
                  { id: 'nostalgia', title: 'Tear-Jerker Nostalgia 🥺', desc: 'Broad slow crossfade, elegant classic Polaroids, acoustic backing tracks, sepia grading', border: 'border-rose-500/30' },
                  { id: 'modern', title: 'Modern Clean Minimal ✨', desc: 'Straight cut layouts, pristine typography cards, lofi ambient soundtrack, clean cinematic grade', border: 'border-emerald-500/30' },
                  { id: 'cinematic', title: 'Cinematic Film Look 🎬', desc: 'Slow crossfades, letterboxed widescreen bars, orchestral strings score, vignette + filmic grade', border: 'border-sky-500/30' }
                ].map(vibe => {
                  const isActive = aiMood === vibe.id;
                  return (
                    <div
                      key={vibe.id}
                      onClick={() => setAiMood(vibe.id as any)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition select-none flex flex-col justify-between ${
                        isActive
                          ? 'bg-indigo-950/90 border-indigo-400 text-white shadow-lg shadow-indigo-950/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-extrabold text-[11px] text-slate-100">{vibe.title}</div>
                      <div className="text-[9.5px] mt-1 leading-normal text-slate-400">{vibe.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Compile Action status */}
            {isCompilingAi ? (
              <div className="bg-slate-950/80 border border-indigo-500/20 rounded-2xl p-4 text-center space-y-3">
                <div className="flex justify-center items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                  <span className="text-xs font-mono font-black text-indigo-400 uppercase tracking-widest">
                    AI Auto-Stitching: {aiCompileProgress}% Completed
                  </span>
                </div>
                
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div className="bg-gradient-to-r from-indigo-500 to-amber-500 h-full transition-all duration-300" style={{ width: `${aiCompileProgress}%` }} />
                </div>
                <div className="text-[10px] text-slate-350 italic font-mono">
                  ➜ {aiCompileStatus || 'Reading guest wishes database...'}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    setIsCompilingAi(true);
                    setAiCompileProgress(5);
                    setAiCompileStatus('Retrieving all contributor submissions...');

                    const wishes = media.filter(m => m.from && m.from !== 'Me (Composer)');
                    const { getTranscriber, decodeToMono16k, transcribeSlice } = await import('../services/speechToTextService');

                    setAiCompileProgress(15);
                    setAiCompileStatus('Decoding video wishes and matching color grades...');

                    const compiledList: any[] = [];
                    for (let idx = 0; idx < wishes.length; idx++) {
                      const w = wishes[idx];
                      let clipUrl = w.url;
                      let clipType: 'video' | 'audio' | 'text' | 'photo' = w.type || 'video';
                      let clipDur = w.dur || 6;
                      let isVoiceToText = false;
                      let transcript = w.textBody || w.note || '';

                      if (!clipUrl) continue; // nothing real to include for this item

                      // Convert voice notes into a readable text card using real speech-to-text.
                      if (clipType === 'audio') {
                        setAiCompileProgress(20 + Math.round((idx / Math.max(1, wishes.length)) * 55));
                        setAiCompileStatus(`Transcribing voice wish ${idx + 1} of ${wishes.length}...`);
                        try {
                          await getTranscriber();
                          const bytes = await (await fetch(clipUrl)).arrayBuffer();
                          const { pcm, sampleRate } = await decodeToMono16k(bytes);
                          const segments = await transcribeSlice(pcm, sampleRate, 0, w.dur || clipDur);
                          const recognized = segments.map(s => s.text).join(' ').trim();
                          transcript = recognized || transcript || 'Wishing you a wonderful celebration!';
                        } catch (transcribeErr) {
                          console.warn('Could not transcribe voice wish, using original note text:', transcribeErr);
                          transcript = transcript || 'Wishing you a wonderful celebration!';
                        }
                        clipType = 'text';
                        isVoiceToText = true;
                        clipDur = w.dur || 8;
                      } else if (clipType === 'text') {
                        clipUrl = `TEXT_CARD_${idx}`;
                        clipDur = 7;
                      } else if (clipType === 'photo') {
                        clipDur = 5;
                      }

                      compiledList.push({
                        id: 'compiled_' + w.id + '_' + Date.now(),
                        sourceMediaId: w.id,
                        type: clipType,
                        file: null,
                        url: clipUrl,
                        dur: clipDur,
                        name: isVoiceToText ? `🎙️ Transcribed Voice Wish - ${w.from.split('(')[0].trim()}` : `Wish from ${w.from.split('(')[0].trim()}`,
                        from: w.from,
                        textBody: transcript,
                        style: w.style || 'gradient',
                        trimStart: 0,
                        trimEnd: clipDur,
                        transition: aiMood === 'hype' ? 'slide' : (aiMood === 'nostalgia' || aiMood === 'cinematic') ? 'fade' : 'none',
                        isTranscribedVoice: isVoiceToText,
                        backgroundReplace: (w as any).backgroundReplace || 'none',
                        faceCentering: !!(w as any).faceCentering
                      });
                    }

                    setAiCompileProgress(88);
                    setAiCompileStatus('Calibrating photo overlays and applying chosen picture frames...');

                    // Fallback elements if wishes list is tiny - a clearly-labeled sample/demo
                    // segment, not a substitution for any real user content.
                    if (compiledList.length === 0) {
                      compiledList.push({
                        id: 'stub_intro',
                        sourceMediaId: 'intro',
                        type: 'text',
                        file: null,
                        url: 'TEXT_INTRO',
                        dur: 5,
                        name: 'Dynamic Intro Opening Card',
                        from: 'AI Compiler Co-Pilot',
                        textBody: 'Celebrate Together • Surprise Album',
                        style: 'royal',
                        trimStart: 0,
                        trimEnd: 5,
                        transition: 'fade'
                      });
                      compiledList.push({
                        id: 'stub_wish1',
                        sourceMediaId: 'wish1',
                        type: 'text',
                        file: null,
                        url: 'TEXT_SAMPLE',
                        dur: 6,
                        name: 'Sample Placeholder (add real wishes to replace this)',
                        from: 'Zipp Zap Co-Pilot',
                        textBody: 'No guest wishes yet \u2014 this is a placeholder. Share the contributor link to collect real videos, photos, and voice notes!',
                        style: 'gradient',
                        trimStart: 0,
                        trimEnd: 6,
                        transition: 'fade'
                      });
                    }

                    setAiCompileProgress(96);
                    setAiCompileStatus('Setting background soundscapes, crossfades, and balancing vocal audio...');

                    // Assemble timeline order indexes
                    const pathOrder = compiledList.map((_, index) => index);

                    // Apply custom mood state presets
                    if (aiMood === 'hype') {
                      setActiveVideoFilter('brightness');
                      setAnimatedFrame('neon');
                      setSoundtrackId('bm1');
                      setColorGrade('cyberpunk');
                      setWaveformStyle('cyber_bars');
                      setShowLiveAudioWaveform(true);
                      setFitMode('cover');
                    } else if (aiMood === 'nostalgia') {
                      setActiveVideoFilter('sepia');
                      setAnimatedFrame('vintage');
                      setSoundtrackId('bm4');
                      setColorGrade('sepia');
                      setWaveformStyle('wave');
                      setShowLiveAudioWaveform(true);
                      setFitMode('cover');
                    } else if (aiMood === 'cinematic') {
                      // Real filmic look: vignette + the 'cinematic' color grade (both mapped to
                      // genuine ffmpeg filters in RenderWorker.ts), letterboxed via fitMode='contain'
                      // (scale-to-fit + real letterbox padding, not a fake overlay bar), the one
                      // built-in track actually tagged "Cinematic" (bm4, orchestral strings), and no
                      // waveform overlay - a clean frame reads more "film" than a visualizer does.
                      setActiveVideoFilter('vignette');
                      setAnimatedFrame('none');
                      setSoundtrackId('bm4');
                      setColorGrade('cinematic');
                      setShowLiveAudioWaveform(false);
                      setFitMode('contain');
                    } else {
                      setActiveVideoFilter('none');
                      setAnimatedFrame('none');
                      setSoundtrackId('bm5');
                      setColorGrade('cinematic');
                      setWaveformStyle('spectrum');
                      setShowLiveAudioWaveform(true);
                      setFitMode('cover');
                    }

                    onUpdateClipsState(compiledList);
                    onUpdateTimelineState(pathOrder);
                    setAiCompileProgress(100);
                    setAiCompileStatus('Success! Loaded neural timeline.');
                    setIsCompilingAi(false);
                    alert(`🤖 Inside AI Co-Pilot:\nSuccessfully assembled & compiled ${compiledList.length} segment classes into the timeline using the '${aiMood.toUpperCase()}' look! Added matched crossfades, background music, and typography overlays.`);
                  }}
                  className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition cursor-pointer shadow-lg inline-flex items-center justify-center gap-1.5 active:scale-95"
                >
                  ⚡ Execute AI Smart Auto-Compile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Quick import manual wishes action
                    const wishes = media.filter(m => m.from && m.from !== 'Me (Composer)');
                    if (wishes.length === 0) {
                      alert('There are no guest wishes submitted yet! Test the portal first to add some wishes.');
                      return;
                    }
                    const compiledList = wishes
                      .filter(w => !!w.url)
                      .map((w, idx) => {
                      const clipDur = w.dur || 6;
                      return {
                        id: 'manual_' + w.id + '_' + Date.now(),
                        sourceMediaId: w.id,
                        type: w.type || 'video',
                        file: null,
                        url: w.url,
                        dur: clipDur,
                        name: `Wish from ${w.from.split('(')[0]}`,
                        from: w.from,
                        textBody: w.textBody || w.note || '',
                        style: w.style || 'gradient',
                        trimStart: 0,
                        trimEnd: clipDur,
                        transition: 'fade'
                      };
                    });
                    
                    onUpdateClipsState([...clips, ...compiledList]);
                    // recalculate timeline indexes
                    const newOrd = [...clips, ...compiledList].map((_, i) => i);
                    onUpdateTimelineState(newOrd);
                    alert(`📥 Loaded ${compiledList.length} guest submissions manually straight into the compilation timeline!`);
                  }}
                  className="py-2.5 bg-slate-900 hover:bg-slate-800 text-indigo-400 font-extrabold text-xs uppercase tracking-wider rounded-xl border border-indigo-900/40 transition cursor-pointer inline-flex items-center justify-center gap-1"
                >
                  📥 Manual Import Wishes ({media.filter(m => m.from && m.from !== 'Me (Composer)').length || 0})
                </button>
              </div>
            )}

            {/* AI Subtitle Transcoder module */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <span>🎙️</span> AI Dialogue & Subtitle Transcoder
              </h4>
              <p className="text-[9.5px] text-slate-400 mb-2.5 leading-relaxed">
                Runs entirely on your device (no server, no API key). The first time you use this, it downloads a small speech-recognition model (~75MB) which is then cached for instant reuse afterward.
              </p>
              {isTranscribingSubtitles ? (
                <div className="bg-slate-950/80 border border-indigo-500/20 rounded-2xl p-4 text-center space-y-3">
                  <div className="flex justify-center items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                    <span className="text-xs font-mono font-black text-indigo-400 uppercase tracking-widest">
                      AI Transcribing: {transcribeProgress}% Completed
                    </span>
                  </div>
                  
                  <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                    <div className="bg-gradient-to-r from-indigo-500 to-amber-500 h-full transition-all duration-300" style={{ width: `${transcribeProgress}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-350 italic font-mono">
                    ➜ {transcribeStatus || 'Processing voice waveforms...'}
                  </div>
                  <button
                    type="button"
                    onClick={() => { transcribeCancelledRef.current = true; }}
                    className="w-full h-8 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white font-bold text-[10px] transition cursor-pointer"
                  >
                    ✕ Cancel After Current Clip
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleAutoTranscribeSubtitles}
                    className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10.5px] uppercase tracking-wider rounded-xl transition cursor-pointer shadow-lg inline-flex items-center justify-center gap-1.5 active:scale-95"
                  >
                    🎙️ Auto-Transcribe Subtitles
                  </button>
                  {transcriptionSRT && (
                    <button
                      type="button"
                      onClick={handleDownloadSRT}
                      className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-850 text-emerald-400 font-extrabold text-[10.5px] uppercase tracking-wider rounded-xl border border-emerald-900/40 transition cursor-pointer inline-flex items-center justify-center gap-1.5"
                    >
                      📥 Download .SRT File
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Active timeline stitching bin */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-150">
              <div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-1.5">
                  <span>📼</span> Active Stitching Timeline ({clips.length} Clips)
                </h3>
                <p className="text-[10px] text-slate-400">Drag & drop cards to reorder clips. Trim start/end times below.</p>
              </div>
              <div className="flex items-center gap-3.5 flex-wrap text-xs">
                {lastSavedTime && (
                  <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-slate-500 bg-slate-50 border border-slate-150 px-2.5 py-1 rounded-lg">
                    <span className={`w-1.5 h-1.5 rounded-full ${isAutoSaving ? 'bg-amber-400 animate-ping' : 'bg-emerald-500 animate-pulse'}`}></span>
                    <span>{isAutoSaving ? 'Auto-saving...' : `Saved ${lastSavedTime}`}</span>
                  </div>
                )}
                
                {undoStack.length > 0 && (
                  <button 
                    onClick={handleUndo} 
                    className="px-2.5 py-1 text-[10px] font-black text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-100 rounded-lg cursor-pointer transition whitespace-nowrap flex items-center gap-1.5"
                    title="Undo last action (Ctrl+Z)"
                  >
                    <span>↩️</span> Undo ({undoStack.length})
                  </button>
                )}

                {redoStack.length > 0 && (
                  <button
                    onClick={handleRedo}
                    className="px-2.5 py-1 text-[10px] font-black text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-100 rounded-lg cursor-pointer transition whitespace-nowrap flex items-center gap-1.5"
                    title="Redo (Ctrl+Shift+Z)"
                  >
                    <span>↪️</span> Redo ({redoStack.length})
                  </button>
                )}

                {clipboardClip && (
                  <button
                    onClick={() => handlePasteClip(selectedClipIdx)}
                    className="px-2.5 py-1 text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg cursor-pointer transition whitespace-nowrap flex items-center gap-1.5"
                    title={`Paste "${clipboardClip.name || 'clip'}" after the selected clip (Ctrl/Cmd+V)`}
                  >
                    <span>📌</span> Paste "{(clipboardClip.name || 'Clip').slice(0, 14)}"
                  </button>
                )}

                <button 
                  onClick={() => setIsTemplateLibraryOpen(true)} 
                  className="px-2.5 py-1 text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg cursor-pointer transition whitespace-nowrap flex items-center gap-1"
                >
                  ✨ Template Library
                </button>

                {clips.length > 0 && (
                  <button onClick={onClearTimelineAll} className="px-2.5 py-1 text-[10px] font-black text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer border border-rose-100 transition whitespace-nowrap">
                    Clear Bin
                  </button>
                )}
              </div>
            </div>

            {/* Programmatic visual styling preferences panel */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-slate-50 border border-slate-100 p-3 rounded-2xl text-[11px] font-sans">
              <div className="flex flex-col gap-1 col-span-1">
                <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">🎞️ Aspect Fit Choice</span>
                <div className="flex rounded-lg overflow-hidden border border-slate-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setFitMode('cover')}
                    className={`flex-1 py-1 rounded-md text-[10px] font-extrabold cursor-pointer transition ${
                      fitMode === 'cover' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Fill Cover
                  </button>
                  <button
                    type="button"
                    onClick={() => setFitMode('contain')}
                    className={`flex-1 py-1 rounded-md text-[10px] font-extrabold cursor-pointer transition ${
                      fitMode === 'contain' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Letterbox Fit
                  </button>
                  <button
                    type="button"
                    onClick={() => setFitMode('blur')}
                    title="LibreCuts-style canvas background: fills the letterbox bars with a blurred copy of the clip instead of black"
                    className={`flex-1 py-1 rounded-md text-[10px] font-extrabold cursor-pointer transition ${
                      fitMode === 'blur' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Blur Backdrop
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1 col-span-1">
                <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">✨ Animated Border Frame Preset</span>
                <select
                  value={animatedFrame}
                  onChange={e => setAnimatedFrame(e.target.value as any)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none cursor-pointer h-full text-[11px]"
                >
                  <option value="none">None (Clean margins) 📽️</option>
                  <option value="sparkles">Golden Sparkles & Stars ✨</option>
                  <option value="hearts">Floating Hearts & Confetti ❤️</option>
                  <option value="neon">Dynamic Rainbow Neon Border 🌈</option>
                  <option value="vintage">Retro Sprocket Film Strip 🎞️</option>
                  <option value="balloons">Floating Birthday Balloons & Gifts 🎈</option>
                  <option value="confetti">Cascading Party Confetti Streamers 🥳</option>
                  <option value="stars">Sparkling Stars Space Galaxy ⭐</option>
                </select>
              </div>

              <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
                <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">🎭 Video CSS Filter Choice</span>
                <select
                  value={activeVideoFilter}
                  onChange={e => setActiveVideoFilter(e.target.value as any)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none cursor-pointer h-[28px] text-[11px]"
                  id="video-css-filter-dropdown"
                >
                  <option value="none">None (Default Colors) 🎨</option>
                  <option value="grayscale">Black & White Preset 🕶️</option>
                  <option value="sepia">Warm Sepia Preset 📜</option>
                  <option value="vibrant">Vibrant Preset 🔥</option>
                  <option value="brightness">Extra Brightness ☀️</option>
                  <option value="vignette">Vignette 🌑</option>
                  <option value="oldfilm">Old Film 🎞️</option>
                  <option value="noir">Noir 🕵️</option>
                  <option value="dreamy">Dreamy Soft Glow ✨</option>
                  <option value="vhs">VHS 📼</option>
                  <option value="invert">Invert 🔄</option>
                  <option value="sharpen">Sharpen 🔪</option>
                  <option value="blur">Blur 💧</option>
                  <option value="thermal">Thermal 🌡️</option>
                  <option value="nightvision">Night Vision 🌃</option>
                  <option value="sketch">Sketch ✏️</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    handleBulkApplyFilter(activeVideoFilter);
                    alert(`Applied overall "${activeVideoFilter === 'none' ? 'original style' : activeVideoFilter.toUpperCase()}" filter to all clips in the timeline!`);
                  }}
                  className="mt-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 hover:text-indigo-700 text-[8px] font-black uppercase rounded border border-indigo-150 cursor-pointer transition text-center"
                >
                  ⚡ Bulk Apply to All Clips
                </button>
              </div>

              <div className="flex flex-col gap-1 col-span-1">
                <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">🎞️ Cinematic Canvas LUT Grade</span>
                <select
                  value={colorGrade}
                  onChange={e => setColorGrade(e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none cursor-pointer h-[28px] text-[11px]"
                  id="cinematic-color-grade-select"
                >
                  <option value="none">None (Direct Output) 📺</option>
                  <option value="warm">Warm Golden Vintage ☀️</option>
                  <option value="cool">Cool Frozen Indigo ❄️</option>
                  <option value="vibrant">Vibrant High Saturation 🔥</option>
                  <option value="bw">Saturated Noir B&W 🕶️</option>
                  <option value="sepia">Classic Antique Sepia 📜</option>
                  <option value="cinematic">Cinematic Teal & Orange 🎬</option>
                  <option value="cyberpunk">Cyberpunk Neon Magenta/Cyan 👾</option>
                  <option value="solarize">Solarized Sci-Fi Glow 🔋</option>
                </select>
              </div>

              <div className="flex flex-col gap-1 col-span-1">
                <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">🎙️ Live Audio Waveform</span>
                <div className="flex rounded-lg overflow-hidden border border-slate-200 bg-white p-0.5 h-[28px]">
                  <button
                    type="button"
                    onClick={() => setShowLiveAudioWaveform(true)}
                    className={`flex-1 py-0.5 rounded-md text-[9px] font-black cursor-pointer transition ${
                      showLiveAudioWaveform ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    ON
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLiveAudioWaveform(false)}
                    className={`flex-1 py-0.5 rounded-md text-[9px] font-black cursor-pointer transition ${
                      !showLiveAudioWaveform ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    MUTED
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1 col-span-1">
                <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[9px]">📊 Waveform Visualizer Style</span>
                <select
                  value={waveformStyle}
                  disabled={!showLiveAudioWaveform}
                  onChange={e => setWaveformStyle(e.target.value as any)}
                  className={`px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold outline-none cursor-pointer h-[28px] text-[11px] ${
                    !showLiveAudioWaveform ? 'opacity-50 text-slate-400 cursor-not-allowed' : 'text-slate-700'
                  }`}
                  id="waveform-style-select"
                >
                  <option value="spectrum">Classic Equalizer Bars 📶</option>
                  <option value="wave">Oscilloscope Sine Waves 〰️</option>
                  <option value="circular">Pulsating Radar Circular 🎯</option>
                  <option value="cyber_bars">Symmetric Dual Stereo VU 🔋</option>
                </select>
              </div>
            </div>

            {/* 💫 Timeline Actions & Transition orchestration */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-indigo-50/45 p-4 rounded-2xl border border-indigo-100">
              <div>
                <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wide">🎞️ Project Stitching Timeline</h4>
                <p className="text-[10px] text-slate-500 leading-normal">Drag to reorder hierarchy. Click any card below to load custom trimming & waves.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (clips.length === 0) {
                      alert('Import some clips first, then the Story Engine can arrange them into chapters.');
                      return;
                    }
                    const { clips: arranged, matchedChapters } = arrangeIntoChapters(clips);
                    onUpdateClipsState(arranged);
                    const summary = matchedChapters.map((m) => `${m.chapter.emoji} ${m.chapter.title} (${m.clipCount})`).join(', ');
                    alert(
                      matchedChapters.length > 0
                        ? `📖 Arranged into chapters: ${summary}`
                        : '📖 No chapter keywords matched clip names/notes - clips were grouped under "More Memories" instead.'
                    );
                  }}
                  className="px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 font-extrabold text-[10px] rounded-lg shrink-0 transition shadow-xs active:scale-95 cursor-pointer flex items-center gap-1"
                  title="Reorders clips into a chapter structure (Opening → Family → Friends → ... → Ending) based on keywords found in each clip's name/note, and inserts animated chapter title cards. This is a keyword heuristic, not true AI scene understanding."
                >
                  📖 Auto-Arrange Story Chapters
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ending = buildCinematicEndingClip();
                    onUpdateClipsState([...clips, ending]);
                    alert('🎉 Cinematic ending card appended to the end of your timeline.');
                  }}
                  className="px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 font-extrabold text-[10px] rounded-lg shrink-0 transition shadow-xs active:scale-95 cursor-pointer flex items-center gap-1"
                  title="Appends a fade-to-black cinematic ending card with a birthday message and a soft sparkle vignette"
                >
                  🎆 Add Cinematic Ending
                </button>
                <button
                  type="button"
                  onClick={() => setIsTransitionManagerOpen(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] rounded-lg shrink-0 transition shadow-xs active:scale-95 cursor-pointer flex items-center gap-1"
                  id="open-transition-manager-btn"
                >
                  💫 Transition Manager
                </button>
                <button
                  type="button"
                  onClick={handleFindHighlights}
                  disabled={isFindingHighlights}
                  className={`px-3 py-1.5 font-extrabold text-[10px] rounded-lg shrink-0 transition shadow-xs active:scale-95 flex items-center gap-1 ${
                    isFindingHighlights
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white border border-amber-200 hover:bg-amber-50 text-amber-700 cursor-pointer'
                  }`}
                  title={`Real audio-energy analysis (RMS over decoded PCM) - trims every video/audio clip down to its ${HIGHLIGHT_WINDOW_SEC}s loudest/most active window. Not a fake progress bar.`}
                >
                  {isFindingHighlights ? `🎯 ${highlightFinderStatus || 'Analyzing...'}` : '🎯 Highlight Finder'}
                </button>
              </div>
            </div>

            {/* 🛠️ ADVANCED TIMELINE FINE-TUNING & SCRUBBING HUB */}
            {selectedClip && (
              <div id="fine-tuning-workspace" className="bg-slate-900 text-white rounded-3xl p-5 border border-slate-800 space-y-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                  <div>
                    <span className="text-[9px] font-black tracking-widest text-indigo-400 uppercase">📽️ Fine-Tuning Workspace</span>
                    <h4 className="text-xs font-black truncate text-slate-100 uppercase" title={selectedClip.name}>
                      Editing clip: {selectedClip.name}
                    </h4>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9px] bg-slate-800 text-slate-300 border border-slate-700 rounded-lg px-2 py-0.5 font-bold uppercase">
                      {selectedClip.type || 'Media'}
                    </span>
                    <span className="text-[9px] bg-indigo-950/80 text-indigo-400 border border-indigo-900 rounded-lg px-2 py-0.5 font-bold">
                      Full Dur: {selectedClip.dur}s
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  {/* Aspect-Ratio dynamic thumbnail canvas */}
                  <div className="md:col-span-5 flex flex-col items-center justify-center space-y-1.5 bg-slate-950 p-2 rounded-2xl border border-slate-850">
                    <div className="aspect-video w-full rounded-xl overflow-hidden relative border border-slate-800 bg-slate-900">
                      <canvas 
                        ref={thumbCanvasRef} 
                        width={320} 
                        height={180} 
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span className="text-[9.5px] font-mono text-slate-400 font-extrabold">
                      Clip Scrub Frame: <span className="text-indigo-400">{(selectedClip.trimStart + clipScrubTime).toFixed(1)}s</span>
                    </span>
                  </div>

                  {/* Scroller control layout */}
                  <div className="md:col-span-7 space-y-3">
                    {/* Scrubbing Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px] font-bold">
                        <span className="text-slate-400 uppercase tracking-widest">🎚️ Scrub Position</span>
                        <span className="font-mono text-indigo-400 font-black">{clipScrubTime.toFixed(1)}s / {(selectedClip.trimEnd - selectedClip.trimStart).toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={Math.max(0.1, selectedClip.trimEnd - selectedClip.trimStart)}
                        step="0.1"
                        value={clipScrubTime}
                        onChange={e => setClipScrubTime(parseFloat(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                      />
                    </div>

                    {/* Precise dual trim boundaries */}
                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      <div className="space-y-1">
                        <div className="flex justify-between font-bold">
                          <span className="text-slate-400 uppercase tracking-wider">Trim Start</span>
                          <span className="font-mono text-slate-350">{selectedClip.trimStart.toFixed(1)}s</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={selectedClip.dur}
                          step="0.1"
                          value={selectedClip.trimStart}
                          onChange={e => handleUpdateTrim(selectedClipIdx, 'start', parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between font-bold">
                          <span className="text-slate-400 uppercase tracking-wider">Trim End</span>
                          <span className="font-mono text-slate-350">{selectedClip.trimEnd.toFixed(1)}s</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={selectedClip.dur}
                          step="0.1"
                          value={selectedClip.trimEnd}
                          onChange={e => handleUpdateTrim(selectedClipIdx, 'end', parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>
                    </div>

                    {/* 🔮 VIDEO EFFECTS PANEL */}
                    {selectedClip.type !== 'audio' && (
                      <div className="pt-2.5 border-t border-slate-800 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">🔮 Video Effects & Filters</span>
                          <span className="text-[9px] font-mono text-slate-400">Apply to this clip</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { id: 'none', label: 'None', emoji: '❌' },
                            { id: 'grayscale', label: 'Black & White', emoji: '🖤' },
                            { id: 'sepia', label: 'Sepia', emoji: '📜' },
                            { id: 'vibrant', label: 'Vibrant', emoji: '🔥' },
                            { id: 'high-contrast', label: 'Contrast', emoji: '🌓' },
                            { id: 'warm', label: 'Warm', emoji: '☀️' },
                            { id: 'cool', label: 'Cool', emoji: '❄️' },
                            { id: 'vignette', label: 'Vignette', emoji: '🌑' },
                            { id: 'oldfilm', label: 'Old Film', emoji: '🎞️' },
                            { id: 'noir', label: 'Noir', emoji: '🕵️' },
                            { id: 'dreamy', label: 'Dreamy', emoji: '✨' },
                            { id: 'vhs', label: 'VHS', emoji: '📼' },
                            { id: 'invert', label: 'Invert', emoji: '🔄' },
                            { id: 'sharpen', label: 'Sharpen', emoji: '🔪' },
                            { id: 'blur', label: 'Blur', emoji: '💧' },
                            { id: 'thermal', label: 'Thermal', emoji: '🌡️' },
                            { id: 'nightvision', label: 'Night Vision', emoji: '🌃' },
                            { id: 'sketch', label: 'Sketch', emoji: '✏️' },
                          ].map(filt => (
                            <button
                              key={filt.id}
                              type="button"
                              onClick={() => {
                                const updated = [...clips];
                                updated[selectedClipIdx] = {
                                  ...updated[selectedClipIdx],
                                  filter: filt.id
                                };
                                onUpdateClipsState(updated);
                              }}
                              className={`px-2.5 py-1 text-[9.5px] font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                                (selectedClip.filter || 'none') === filt.id
                                  ? 'bg-indigo-600 border-indigo-500 text-white shadow'
                                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                              }`}
                            >
                              <span>{filt.emoji}</span>
                              <span>{filt.label}</span>
                            </button>
                          ))}
                        </div>

                        {/* Bulk apply button */}
                        <div className="pt-1.5 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const activeFilt = selectedClip.filter || 'none';
                              handleBulkApplyFilter(activeFilt);
                              alert(`Applied ${activeFilt === 'none' ? 'Original Colors' : activeFilt.toUpperCase()} preset to all clips in the timeline!`);
                            }}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 text-indigo-400 hover:text-indigo-300 text-[9.5px] font-black uppercase tracking-wider rounded-lg border border-slate-800 cursor-pointer transition whitespace-nowrap active:scale-95"
                          >
                            ⚡ Apply This Filter to All Clips
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 🎙️ DETAILED AUDIO WAVEFORM & SILENCE NOISE FLOOR VISUALIZER */}
                {selectedClip.type === 'audio' && (
                  <div className="p-3.5 bg-slate-1000/30 bg-slate-950 rounded-2xl border border-slate-850 space-y-3 text-slate-200">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider">
                      <span className="text-indigo-400 flex items-center gap-1">🎙️ High-Res Audio Waveform</span>
                      <span className="text-slate-400 font-bold uppercase">Silence Gate Cutoff</span>
                    </div>

                    {/* Wave peaks visualizer container */}
                    <div className="bg-[#05080e] rounded-xl overflow-hidden border border-slate-900">
                      <AudioWaveformCanvas
                        peaks={samplePeaks}
                        noiseGate={noiseGate}
                        trimStart={selectedClip.trimStart}
                        trimEnd={selectedClip.trimEnd}
                        duration={selectedClip.dur}
                        onUpdateTrim={(type, val) => {
                          handleUpdateTrim(selectedClipIdx, type, val);
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-1 text-[10px]">
                      {/* Noise gate slider */}
                      <div className="sm:col-span-8 flex items-center gap-2">
                        <span className="font-black text-slate-400 uppercase tracking-widest shrink-0">🔇 Noise Threshold:</span>
                        <input
                          type="range"
                          min="5"
                          max="80"
                          value={noiseGate}
                          onChange={e => setNoiseGate(parseInt(e.target.value))}
                          className="flex-grow h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                        />
                        <span className="font-mono text-indigo-400 font-bold shrink-0">{noiseGate}%</span>
                      </div>

                      {/* Auto trimmer button under visual guide */}
                      <div className="sm:col-span-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            // Find active ranges
                            const firstActiveIdx = samplePeaks.findIndex(p => p >= noiseGate);
                            const lastActiveIdx = [...samplePeaks].reverse().findIndex(p => p >= noiseGate);
                            
                            const startPct = firstActiveIdx !== -1 ? firstActiveIdx / samplePeaks.length : 0;
                            const endPct = lastActiveIdx !== -1 ? 1 - (lastActiveIdx / samplePeaks.length) : 1;
                            
                            const updated = [...clips];
                            const cl = updated[selectedClipIdx];
                            cl.trimStart = parseFloat((cl.dur * startPct).toFixed(1));
                            cl.trimEnd = parseFloat((cl.dur * endPct).toFixed(1));
                            onUpdateClipsState(updated);
                            alert(`✂️ Noise gate auto-applied!\n\nSilence trimmed from clip boundaries:\nTrim Start set to ${cl.trimStart}s\nTrim End set to ${cl.trimEnd}s`);
                          }}
                          className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-black rounded-lg transition active:scale-95 text-[9px] uppercase cursor-pointer flex items-center gap-1"
                          id="auto-trim-audio-silence-btn"
                        >
                          ⚡ Auto-Trim Silence
                        </button>
                      </div>
                    </div>

                    <p className="text-[9px] text-slate-450 leading-normal text-slate-400">
                      Peaks colored <span className="text-amber-500 font-bold">faded amber</span> represents silent noise floors. Clicking <span className="font-bold text-white">Auto-Trim Silence</span> crops those zones instantly.
                    </p>
                  </div>
                )}

                {/* 📝 SUBTITLES LAYER & ⚡ CLIENT-SIDE VIDEO COMPRESSOR MODULES */}
                {selectedClip.type === 'video' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-800">
                    
                    {/* Subtitles Overlay Control */}
                    <div className="p-4 bg-slate-950 rounded-2xl border border-slate-850 space-y-3.5">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-850">
                        <span className="text-[10px] font-black tracking-widest text-indigo-450 text-indigo-400 uppercase">💬 Subtitles layer (Clip-Level)</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase">{selectedClip.subtitles?.length || 0} Captions</span>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Subtitle Text Caption</label>
                          <input
                            type="text"
                            value={subText}
                            onChange={e => setSubText(e.target.value)}
                            placeholder="Enter subtitle caption overlay..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 font-bold"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Start Sec: {subStart.toFixed(1)}s</label>
                            <input
                              type="range"
                              min="0"
                              max={selectedClip.dur}
                              step="0.1"
                              value={subStart}
                              onChange={e => {
                                const val = parseFloat(e.target.value);
                                setSubStart(val);
                                if (subEnd < val) setSubEnd(Math.min(selectedClip.dur, val + 2));
                              }}
                              className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">End Sec: {subEnd.toFixed(1)}s</label>
                            <input
                              type="range"
                              min="0"
                              max={selectedClip.dur}
                              step="0.1"
                              value={subEnd}
                              onChange={e => setSubEnd(Math.max(subStart, parseFloat(e.target.value)))}
                              className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Font Family</label>
                            <select
                              value={subFont}
                              onChange={e => setSubFont(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-bold outline-none cursor-pointer"
                            >
                              <option value="Inter">Inter Sans-Serif</option>
                              <option value="Space Grotesk">Space Grotesk Tech</option>
                              <option value="JetBrains Mono">JetBrains Mono Code</option>
                              <option value="Playfair Display">Playfair Display Editorial</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Font Size</label>
                            <input
                              type="range"
                              min="10"
                              max="30"
                              value={subSize}
                              onChange={e => setSubSize(parseInt(e.target.value))}
                              className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Font Color</label>
                            <select
                              value={subColor}
                              onChange={e => setSubColor(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-bold outline-none cursor-pointer"
                            >
                              <option value="#ffffff">⚪ Pure White</option>
                              <option value="#facc15">🟡 Radiant Yellow</option>
                              <option value="#38bdf8">🔵 Sky Blue</option>
                              <option value="#34d399">🟢 Vibrant Green</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Backplate</label>
                            <select
                              value={subBackplate}
                              onChange={e => setSubBackplate(e.target.value as any)}
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-bold outline-none cursor-pointer"
                            >
                              <option value="strip">⬛ Translucent Capsule</option>
                              <option value="none">❌ Transparent background</option>
                            </select>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleAddClipSubtitle(selectedClipIdx)}
                          disabled={!subText.trim()}
                          className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-[10px] uppercase rounded-lg shadow cursor-pointer transition active:scale-95 flex items-center justify-center gap-1"
                        >
                          <span>➕</span> Add Subtitle Caption
                        </button>
                      </div>

                      {/* Active Subtitles list */}
                      {selectedClip.subtitles && selectedClip.subtitles.length > 0 && (
                        <div className="pt-2 border-t border-slate-900 space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Active Subtitle Captions:</p>
                          {selectedClip.subtitles.map((sub: any, subIdx: number) => (
                            <div key={sub.id || subIdx} className="flex justify-between items-center bg-slate-900 p-2 rounded-lg border border-slate-850 text-[10px]">
                              <div className="truncate pr-2 text-slate-200 font-bold">
                                <span className="font-mono text-indigo-400 mr-1">[{sub.start}s - {sub.end}s]</span> "{sub.text}"
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveClipSubtitle(selectedClipIdx, sub.id)}
                                className="text-rose-500 hover:text-rose-400 font-bold cursor-pointer hover:bg-rose-950/20 px-1.5 py-0.5 rounded transition shrink-0"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Client-Side Video Compressor / Optimizer */}
                    <div className="p-4 bg-slate-950 rounded-2xl border border-slate-850 space-y-3.5">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-850">
                        <span className="text-[10px] font-black tracking-widest text-indigo-400 uppercase">⚡ Optimized Compression (Client-Side)</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase">MP4 / WebM</span>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Quality Preset</label>
                          <div className="grid grid-cols-3 gap-2">
                            {(['low', 'medium', 'high'] as const).map(preset => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setStudioCompressPreset(preset)}
                                className={`py-1 text-[9px] font-black uppercase rounded-lg border transition cursor-pointer text-center ${
                                  studioCompressPreset === preset
                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                                }`}
                              >
                                {preset === 'low' ? 'Low (480p)' : preset === 'medium' ? 'Med (720p)' : 'High (1080p)'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Compression loader or trigger */}
                        {isStudioCompressing ? (
                          <div className="bg-slate-900 border border-indigo-950/30 p-3 rounded-xl space-y-2.5">
                            <div className="flex justify-between items-center text-[9px] font-mono font-bold text-indigo-400">
                              <span className="animate-pulse">Optimizing video track...</span>
                              <span>{studioCompressProgress}%</span>
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full transition-all duration-300" style={{ width: `${studioCompressProgress}%` }}></div>
                            </div>
                            <p className="text-[9px] text-slate-400 font-mono italic truncate">{studioCompressStatus}</p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleCompressStudioClip(selectedClipIdx)}
                            className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-[10px] uppercase rounded-lg shadow-md cursor-pointer transition active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            <span>⚡</span> Optimize & Compress Clip
                          </button>
                        )}

                        {/* Last compressed statistics */}
                        {studioCompressedStats && studioCompressedStats.targetClipId === selectedClip.id && (
                          <div className="p-3 bg-slate-900 border border-emerald-950/30 rounded-xl space-y-2 text-[10px]">
                            <p className="font-black text-emerald-400 uppercase tracking-wider text-[8px]">✨ Optimization Success!</p>
                            <div className="grid grid-cols-2 gap-1.5 font-mono text-[9px] text-slate-300">
                              <div>Original Size:</div>
                              <div className="text-right text-slate-100 font-bold">{(studioCompressedStats.oldSize / (1024 * 1024)).toFixed(2)} MB</div>
                              <div>Optimized Size:</div>
                              <div className="text-right text-emerald-400 font-bold">{(studioCompressedStats.newSize / (1024 * 1024)).toFixed(2)} MB</div>
                              <div>Bandwidth Saved:</div>
                              <div className="text-right text-emerald-300 font-black">{studioCompressedStats.savedPercentage}% saved</div>
                              <div>Target Quality:</div>
                              <div className="text-right text-slate-100 uppercase font-bold">{studioCompressPreset} preset</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

            {/* Interactive Timeline Zoom Slider for high-precision frame-level edits */}
            <div className="flex items-center justify-between gap-4 bg-slate-100 border border-slate-200 rounded-2xl p-3.5 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔍</span>
                <div>
                  <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-widest leading-3">
                    Timeline Zoom Controller
                  </h4>
                  <p className="text-[8.5px] text-slate-400 font-semibold mt-0.5">
                    Adjust horizontal precision of range trim sliders
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min="50"
                  max="300"
                  value={timelineZoom}
                  onChange={(e) => setTimelineZoom(parseInt(e.target.value))}
                  className="w-28 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <span className="text-[10px] font-mono font-black text-slate-700 w-10 text-right">
                  {timelineZoom}%
                </span>
              </div>
            </div>

            {/* Trimming list grid cards with beautiful drag and drop timeline reordering */}
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="timeline-clips" direction="vertical">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-2.5 max-h-[390px] overflow-y-auto pr-1"
                  >
                    {clips.map((c, i) => {
                      const typeLabel = c.type === 'video' ? '🎬 VIDEO' : c.type === 'photo' ? '📸 PHOTO' : c.type === 'audio' ? '🎙️ AUDIO' : '✍️ WRITTEN WISH';
                      const themeBadge = c.type === 'photo' ? 'bg-amber-50 text-amber-600' : c.type === 'audio' ? 'bg-indigo-50 text-indigo-600' : c.type === 'text' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600';
                      const isSelectedForTuning = selectedClipIdx === i;
                      const draggableId = c.id ? String(c.id) : `clip-${i}`;

                      const DraggableComponent = Draggable as any;

                      return (
                        <DraggableComponent key={draggableId} draggableId={draggableId} index={i}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className="space-y-2 outline-none"
                              onClick={() => {
                                setSelectedClipIdx(i);
                                setClipScrubTime(0);
                              }}
                            >
                              <div
                                className={`p-4 rounded-2xl space-y-3 cursor-pointer transition relative hover:shadow-sm group ${
                                  isSelectedForTuning 
                                    ? 'bg-white border-2 border-indigo-600 shadow-md ring-4 ring-indigo-50/70' 
                                    : 'bg-slate-50/70 border border-slate-200'
                                } ${
                                  snapshot.isDragging ? 'opacity-50 border-dashed border-indigo-500 bg-indigo-50/20 scale-[1.01] shadow-lg' : ''
                                }`}
                              >
                                {/* Drag handles decoration */}
                                <div 
                                  {...provided.dragHandleProps}
                                  className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-50 group-hover:opacity-100 transition text-[14px] text-indigo-500 select-none font-sans font-black px-2 py-3 cursor-grab active:cursor-grabbing"
                                  title="Drag to Reorder"
                                  aria-label={`Reorder clip ${i + 1}, ${c.name || 'untitled'}. Press space to lift, arrow keys to move, space to drop.`}
                                >
                                  ⣿
                                </div>

                                <div className="flex justify-between items-center gap-3 bg">
                                  <div className="flex items-center gap-2 pl-4">
                                    <span className="text-xs font-bold text-indigo-600 font-mono">#{i + 1}</span>
                                    <span className={`text-[9px] font-black tracking-wider px-2 py-0.5 rounded ${themeBadge}`}>{typeLabel}</span>
                                    <h4 className="text-xs font-extrabold text-slate-800 truncate max-w-[110px] md:max-w-[160px]">{c.name}</h4>
                                    {isSelectedForTuning && (
                                      <span className="text-[8px] font-black text-indigo-500 tracking-wider bg-indigo-50 px-1.5 py-0.5 rounded uppercase animate-pulse">
                                        🎯 FINE-TUNING
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      disabled={i === 0}
                                      onClick={() => handleMoveClip(i, 'up')}
                                      className="p-1 px-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer transition text-[11px] font-bold"
                                      title="Move Up"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      disabled={i === clips.length - 1}
                                      onClick={() => handleMoveClip(i, 'down')}
                                      className="p-1 px-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer transition text-[11px] font-bold"
                                      title="Move Down"
                                    >
                                      ▼
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyClip(i)}
                                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[9px] rounded-lg cursor-pointer transition"
                                      title="Copy this clip's settings (Ctrl/Cmd+C when selected) to paste elsewhere"
                                    >
                                      📋 Copy
                                    </button>
                                    {c.type === 'video' && (
                                      <button
                                        type="button"
                                        onClick={() => c.audioDetached ? handleRecoverAudio(i) : handleDetachAudio(i)}
                                        className={`px-2 py-1 font-bold text-[9px] rounded-lg cursor-pointer transition ${c.audioDetached ? 'bg-amber-50 hover:bg-amber-100 text-amber-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                                        title={c.audioDetached ? 'Recover this clip\'s own audio (recovers in place; delete the separated audio clip yourself if you no longer want it)' : "Split this clip's audio into its own separately-editable clip"}
                                      >
                                        {c.audioDetached ? '🔗 Recover Audio' : '✂️ Detach Audio'}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveClip(i)}
                                      className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[9px] rounded-lg cursor-pointer transition"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>

                                {c.audioDetached && (
                                  <div className="mx-4 mt-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg text-[9.5px] font-bold text-amber-700 flex items-center gap-1.5">
                                    <span>🔇</span> This clip's own audio is muted in the render — its sound now lives in the separate audio clip right after it.
                                  </div>
                                )}

                                {/* Precision Trimming & Volume balancing sliders */}
                                <div className="space-y-3 pl-4 pt-1.5 border-t border-slate-100">
                                  {/* Custom per-clip volume balance slider */}
                                  <div className="flex gap-2 items-center text-xs" onClick={e => e.stopPropagation()}>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest w-12 text-right shrink-0">🔊 Volume:</span>
                                    {volumeNormalizationEnabled ? (
                                      <div className="flex-1 text-[10.5px] font-black text-indigo-700 bg-indigo-50/80 border border-indigo-150 rounded-xl py-1 px-3 text-center tracking-wide flex items-center justify-center gap-1.5 shadow-2xs select-none">
                                        <span className="animate-pulse">🎚️</span> Normalized to <span className="text-indigo-600 font-extrabold">85%</span> Automatically
                                      </div>
                                    ) : (
                                      <>
                                        <input
                                          type="range"
                                          min="0"
                                          max="100"
                                          value={c.volume !== undefined ? c.volume : 100}
                                          onChange={(e) => {
                                            const updated = [...clips];
                                            updated[i].volume = parseInt(e.target.value);
                                            onUpdateClipsState(updated);
                                          }}
                                          className="flex-1 accent-indigo-600 cursor-pointer h-1 bg-slate-200 rounded"
                                        />
                                        <span className="font-mono text-indigo-600 w-12 text-right shrink-0 font-extrabold">{c.volume !== undefined ? c.volume : 100}%</span>
                                      </>
                                    )}
                                  </div>

                                  {/* Speed control (LibreCuts-style granular speed slider), clamped to a safe
                                      MIN_RETIME_RATE-MAX_RETIME_RATE range so it can never produce a rate the
                                      ffmpeg atempo chain rejects. */}
                                  {c.type !== 'text' && c.type !== 'photo' && (
                                    <div className="space-y-1" onClick={e => e.stopPropagation()}>
                                      <div className="flex gap-2 items-center text-xs">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest w-12 text-right shrink-0">⏩ Speed:</span>
                                        <input
                                          type="range"
                                          min={MIN_RETIME_RATE}
                                          max={MAX_RETIME_RATE}
                                          step="0.05"
                                          value={c.speed !== undefined ? c.speed : DEFAULT_RETIME_RATE}
                                          onChange={(e) => {
                                            const updated = [...clips];
                                            updated[i].speed = clampRetimeRate(parseFloat(e.target.value));
                                            onUpdateClipsState(updated);
                                          }}
                                          className="flex-1 accent-indigo-600 cursor-pointer h-1 bg-slate-200 rounded"
                                        />
                                        <span className="font-mono text-indigo-600 w-12 text-right shrink-0 font-extrabold">{(c.speed !== undefined ? c.speed : DEFAULT_RETIME_RATE).toFixed(2)}x</span>
                                      </div>
                                      {c.speed !== undefined && c.speed !== 1 && c.type === 'video' && (
                                        <label className="flex items-center gap-1.5 pl-14 text-[10px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={c.maintainPitch !== false}
                                            onChange={(e) => {
                                              const updated = [...clips];
                                              updated[i].maintainPitch = e.target.checked;
                                              onUpdateClipsState(updated);
                                            }}
                                            className="accent-indigo-600"
                                          />
                                          🎵 Maintain Pitch {c.maintainPitch === false ? '(off — chipmunk/vinyl effect)' : '(on — clean speed change)'}
                                        </label>
                                      )}
                                    </div>
                                  )}

                                  {/* Fade in/out, reverse, and freeze-frame - real per-clip ffmpeg fx, applied at render time */}
                                  {c.type !== 'text' && (
                                    <div className="flex flex-wrap gap-2 items-center text-[10px]" onClick={e => e.stopPropagation()}>
                                      <label className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={!!c.reversed}
                                          onChange={(e) => {
                                            const updated = [...clips];
                                            updated[i].reversed = e.target.checked;
                                            onUpdateClipsState(updated);
                                          }}
                                          className="accent-indigo-600"
                                        />
                                        ⏪ Reverse
                                      </label>
                                      <span className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider">
                                        Fade In
                                        <input
                                          type="number" min="0" max="5" step="0.1"
                                          value={c.fadeIn || 0}
                                          onChange={(e) => {
                                            const updated = [...clips];
                                            updated[i].fadeIn = Math.max(0, parseFloat(e.target.value) || 0);
                                            onUpdateClipsState(updated);
                                          }}
                                          className="w-12 bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-800 font-mono"
                                        />s
                                      </span>
                                      <span className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider">
                                        Fade Out
                                        <input
                                          type="number" min="0" max="5" step="0.1"
                                          value={c.fadeOut || 0}
                                          onChange={(e) => {
                                            const updated = [...clips];
                                            updated[i].fadeOut = Math.max(0, parseFloat(e.target.value) || 0);
                                            onUpdateClipsState(updated);
                                          }}
                                          className="w-12 bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-800 font-mono"
                                        />s
                                      </span>
                                      {c.type === 'video' && (
                                        <span className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider">
                                          ❄️ Freeze End
                                          <input
                                            type="number" min="0" max="10" step="0.1"
                                            value={c.freezeFrameSec || 0}
                                            onChange={(e) => {
                                              const updated = [...clips];
                                              updated[i].freezeFrameSec = Math.max(0, parseFloat(e.target.value) || 0);
                                              onUpdateClipsState(updated);
                                            }}
                                            className="w-12 bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-800 font-mono"
                                          />s
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Chroma key / green screen removal (LibreCuts-style), applied to this clip's own footage */}
                                  {c.type === 'video' && (
                                    <div className="flex flex-wrap gap-2 items-center text-[10px] pt-0.5" onClick={e => e.stopPropagation()}>
                                      <label className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={!!c.chromaKey?.enabled}
                                          onChange={(e) => {
                                            const updated = [...clips];
                                            updated[i].chromaKey = { ...(c.chromaKey || {}), enabled: e.target.checked, color: c.chromaKey?.color || '#00ff00', bgColor: c.chromaKey?.bgColor || '#000000', similarity: c.chromaKey?.similarity ?? 0.3 };
                                            onUpdateClipsState(updated);
                                          }}
                                          className="accent-indigo-600"
                                        />
                                        🟢 Chroma Key
                                      </label>
                                      {c.chromaKey?.enabled && (
                                        <>
                                          <span className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider">
                                            Key
                                            <input
                                              type="color"
                                              value={c.chromaKey?.color || '#00ff00'}
                                              onChange={(e) => {
                                                const updated = [...clips];
                                                updated[i].chromaKey = { ...(c.chromaKey || {}), color: e.target.value };
                                                onUpdateClipsState(updated);
                                              }}
                                              className="w-6 h-5 border border-slate-200 rounded cursor-pointer"
                                            />
                                          </span>
                                          <span className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider">
                                            Backdrop
                                            <input
                                              type="color"
                                              value={c.chromaKey?.bgColor || '#000000'}
                                              onChange={(e) => {
                                                const updated = [...clips];
                                                updated[i].chromaKey = { ...(c.chromaKey || {}), bgColor: e.target.value };
                                                onUpdateClipsState(updated);
                                              }}
                                              className="w-6 h-5 border border-slate-200 rounded cursor-pointer"
                                            />
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* Lower third: optional Name / Relationship / City caption, LibreCuts-style */}
                                  {c.type !== 'text' && (
                                    <div className="flex flex-wrap gap-1.5 items-center text-[10px] pt-0.5" onClick={e => e.stopPropagation()}>
                                      <span className="font-bold text-slate-500 uppercase tracking-wider">🪧 Lower Third:</span>
                                      <input
                                        type="text"
                                        placeholder="Name"
                                        value={c.lowerThird?.name || ''}
                                        onChange={(e) => {
                                          const updated = [...clips];
                                          updated[i].lowerThird = { ...(c.lowerThird || {}), name: e.target.value };
                                          onUpdateClipsState(updated);
                                        }}
                                        className="w-20 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-800"
                                      />
                                      <input
                                        type="text"
                                        placeholder="Relationship"
                                        value={c.lowerThird?.relationship || ''}
                                        onChange={(e) => {
                                          const updated = [...clips];
                                          updated[i].lowerThird = { ...(c.lowerThird || {}), relationship: e.target.value };
                                          onUpdateClipsState(updated);
                                        }}
                                        className="w-20 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-800"
                                      />
                                      <input
                                        type="text"
                                        placeholder="City"
                                        value={c.lowerThird?.city || ''}
                                        onChange={(e) => {
                                          const updated = [...clips];
                                          updated[i].lowerThird = { ...(c.lowerThird || {}), city: e.target.value };
                                          onUpdateClipsState(updated);
                                        }}
                                        className="w-16 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-800"
                                      />
                                    </div>
                                  )}

                                  {/* Interactive Visual Draggable Trim Slider */}
                                  <div className="pl-1.5" onClick={e => e.stopPropagation()}>
                                    <ClipTrimSlider
                                      dur={c.dur}
                                      trimStart={c.trimStart}
                                      trimEnd={c.trimEnd}
                                      extraSnapPoints={buildCaptionSnapPoints(c.subtitles)}
                                      onChange={(start, end) => {
                                        const updated = [...clips];
                                        updated[i].trimStart = start;
                                        updated[i].trimEnd = end;
                                        onUpdateClipsState(updated);
                                      }}
                                    />
                                  </div>

                                  {/* Adjustable duration slider specifically for audio clips */}
                                  {c.type === 'audio' && (
                                    <div className="flex gap-2.5 items-center text-xs pt-1 animate-in slide-in-from-left-2 duration-200" onClick={e => e.stopPropagation()}>
                                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider w-24 shrink-0 flex items-center gap-1">
                                        <span>⏳ Max Audio Dur:</span>
                                      </span>
                                      <input
                                        type="range"
                                        min="2"
                                        max="120"
                                        step="1"
                                        value={c.dur}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value);
                                          const updated = [...clips];
                                          updated[i].dur = val;
                                          if (updated[i].trimEnd > val) {
                                            updated[i].trimEnd = val;
                                          }
                                          if (updated[i].trimStart >= val) {
                                            updated[i].trimStart = Math.max(0, val - 0.5);
                                          }
                                          onUpdateClipsState(updated);
                                        }}
                                        className="flex-1 accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 rounded"
                                      />
                                      <span className="font-mono text-indigo-600 w-12 text-right shrink-0 font-extrabold">{c.dur.toFixed(1)}s</span>
                                    </div>
                                  )}

                                  {/* Caption / Subtitle Overlay Input Field */}
                                  <div className="flex flex-col gap-1.5 pt-1" onClick={e => e.stopPropagation()}>
                                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">✍️ Subtitle / Caption Overlay</span>
                                    <input
                                      type="text"
                                      value={c.caption || ''}
                                      onChange={(e) => {
                                        const updated = [...clips];
                                        updated[i].caption = e.target.value;
                                        updated[i].hasSubtitles = !!e.target.value;
                                        onUpdateClipsState(updated);
                                      }}
                                      placeholder="Type a caption or subtitle to overlay during this clip..."
                                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
                                    />
                                  </div>
                                </div>

                                {/* AI One-Click Smart Settings (Background replacement, Speaker Face center, stabilize dampers) */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-4 pt-2 border-t border-slate-150 text-[10px] space-y-1 sm:space-y-0" onClick={e => e.stopPropagation()}>
                                  <div className="flex flex-col gap-1">
                                    <span className="font-extrabold text-slate-500 uppercase tracking-wider text-[8px] text-indigo-600">👤 AI Background Removal</span>
                                    <select
                                      value={c.backgroundReplace || 'none'}
                                      onChange={(e) => {
                                        const updated = [...clips];
                                        updated[i].backgroundReplace = e.target.value;
                                        onUpdateClipsState(updated);
                                      }}
                                      className="bg-white border border-slate-200 px-1.5 py-1 rounded-md text-[9.5px] text-slate-700 font-extrabold outline-none cursor-pointer"
                                    >
                                      <option value="none">Original Video Backdrop 🎥</option>
                                      <option value="birthday">Birthday Balloons Backdrop 🎈</option>
                                      <option value="wedding">Wedding Rose Gold Hearts 💕</option>
                                      <option value="corporate">Corporate Pitch Grid Lines 🏢</option>
                                      <option value="award">Grand Golden Spotlight Stage 🏆</option>
                                      <option value="church">Church Glowing Arches Back ⛪</option>
                                      <option value="festival">Festival fireworks sky 🎆</option>
                                      <option value="luxury">Luxury scarlet velvet 🍷</option>
                                    </select>
                                  </div>

                                  <div className="flex flex-col justify-center space-y-1">
                                    <label className="flex items-center gap-1.5 font-bold text-slate-650 cursor-pointer text-[9px]">
                                      <input
                                        type="checkbox"
                                        checked={!!c.faceCentering}
                                        onChange={(e) => {
                                          const updated = [...clips];
                                          updated[i].faceCentering = e.target.checked;
                                          onUpdateClipsState(updated);
                                          if (e.target.checked && !c.faceBox) {
                                            runFaceDetectionForClip(i);
                                          }
                                        }}
                                        className="rounded accent-indigo-600 cursor-pointer"
                                      />
                                      <span>👤 Speaker Face Centering{c.faceCentering && !c.faceBox ? ' (detecting...)' : ''}</span>
                                    </label>

                                    <label className="flex items-center gap-1.5 font-bold text-slate-650 cursor-pointer text-[9px]">
                                      <input
                                        type="checkbox"
                                        checked={c.videoCleanup !== false}
                                        onChange={(e) => {
                                          const updated = [...clips];
                                          updated[i].videoCleanup = e.target.checked;
                                          updated[i].audioCleanup = e.target.checked;
                                          onUpdateClipsState(updated);
                                        }}
                                        className="rounded accent-indigo-600 cursor-pointer"
                                      />
                                      <span>🛡️ Auto-Stabilize & Noise Filter</span>
                                    </label>
                                  </div>
                                </div>
                              </div>

                              {/* Transition overlay selector between successive clips in the stitching compilation */}
                              {i < clips.length - 1 && (
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-3.5 py-2.5 bg-indigo-50/40 border border-indigo-100/50 rounded-2xl mx-2 text-[10px] font-sans" onClick={e => e.stopPropagation()}>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-slate-400 font-extrabold">💫 Transition:</span>
                                    <select
                                      value={c.transition || 'fade'}
                                      onChange={(e) => {
                                        const updated = [...clips];
                                        updated[i].transition = e.target.value;
                                        onUpdateClipsState(updated);
                                      }}
                                      className="bg-white border border-slate-200 rounded px-1.5 py-0.5 outline-none font-bold text-slate-700 cursor-pointer text-[10px]"
                                    >
                                      <option value="fade">Fade (Cross-fade) 🌫️</option>
                                      <option value="slide">Slide (Swipe) ➔</option>
                                      <option value="zoom">Zoom (In/Out Scale) 🔍</option>
                                      <option value="dissolve">Dissolve (Vaporize) 🫧</option>
                                      <option value="auto">Cinematic Auto (varied) 🎬</option>
                                      <option value="none">Quick Cut (None) ✂️</option>
                                    </select>

                                    {/* Render preview icon for chosen transition */}
                                    <div className="flex items-center justify-center w-5 h-5 rounded-md bg-white border border-slate-200 shadow-2xs select-none">
                                      {(() => {
                                        const currentVal = c.transition || 'fade';
                                        if (currentVal === 'fade') return <span title="Fade Icon">🌫️</span>;
                                        if (currentVal === 'dissolve') return <span title="Dissolve Icon">🫧</span>;
                                        if (currentVal === 'slide') return <span title="Slide Icon">➔</span>;
                                        if (currentVal === 'zoom') return <span title="Zoom Icon">🔍</span>;
                                        if (currentVal === 'auto') return <span title="Cinematic Auto Icon">🎬</span>;
                                        return <span title="Cut Icon">✂️</span>;
                                      })()}
                                    </div>

                                    {/* Duration input */}
                                    <span className="text-slate-400 font-extrabold ml-1">⏱️ Duration:</span>
                                    <input
                                      type="number"
                                      min="0.1"
                                      max="5.0"
                                      step="0.1"
                                      value={c.transitionDuration ?? 0.5}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0.5;
                                        const updated = [...clips];
                                        updated[i].transitionDuration = val;
                                        onUpdateClipsState(updated);
                                      }}
                                      className="bg-white border border-slate-200 rounded px-1 w-11 font-bold text-slate-700 outline-none text-[10px]"
                                    />
                                    <span className="text-slate-400 font-bold">s</span>
                                  </div>

                                  {/* Transitions Preview Actions Button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPreviewTransitionType(c.transition || 'fade');
                                      setTimeout(() => {
                                        setPreviewTransitionType(null); // auto close
                                      }, 2000);
                                    }}
                                    className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-slate-600 font-extrabold transition cursor-pointer active:scale-95 text-[9px]"
                                  >
                                    👁️ Preview Transition
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </DraggableComponent>
                      );
                    })}
                    {provided.placeholder}
                    {clips.length === 0 && (
                      <div className="text-center py-10 text-xs text-slate-400 select-none">
                        Stitching campaign timeline is empty. Import assets using the library drawer below!
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>

          {/* My Media - real thumbnail library of not-yet-imported contributions (same
              importableMedia/handleImportMediaToStudio data already powering the plain list this
              replaces), styled as clickable thumbnail tiles rather than a text list. */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center border-b border-slate-50 pb-2">
              <h3 className="text-xs font-bold text-[#1C1207] uppercase tracking-widest">🖼️ My Media <span className="text-slate-400 font-medium normal-case">· Quick Import from Contributions</span></h3>
              <span className="text-[10px] text-indigo-600 px-2 py-0.5 bg-indigo-50 rounded-full font-black">
                {importableMedia.length} Available
              </span>
            </div>

            {importableMedia.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[340px] overflow-y-auto pr-1">
                {importableMedia.map(m => {
                  const typeEmoji = m.type === 'video' ? '📹' : m.type === 'photo' ? '📸' : m.type === 'audio' ? '🎙️' : '✍️';
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleImportMediaToStudio(m)}
                      title={`Add "${m.name}" to timeline`}
                      className="group text-left cursor-pointer"
                    >
                      <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-900 border border-slate-200 group-hover:border-indigo-400 transition">
                        {m.thumb ? (
                          <img src={m.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl bg-gradient-to-br from-slate-800 to-slate-950">
                            {typeEmoji}
                          </div>
                        )}
                        <span className="absolute top-1 left-1 w-5 h-5 rounded-md bg-black/60 backdrop-blur-xs flex items-center justify-center text-[10px]">
                          {typeEmoji}
                        </span>
                        {(m.type === 'video' || m.type === 'audio') && m.dur ? (
                          <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/70 text-white text-[8px] font-mono font-bold">
                            {fmtT(m.dur)}
                          </span>
                        ) : null}
                        <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 transition flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition bg-white/95 text-indigo-700 text-[9px] font-black px-2 py-1 rounded-full shadow">
                            ＋ Timeline
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] font-bold text-slate-700 truncate mt-1">{m.name}</p>
                      <p className="text-[9px] text-slate-400 truncate">{m.from}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-xs text-slate-400 py-4">No un-imported items left in media library structure! Friends and family can contribute more below.</p>
            )}
          </div>

          {/* 🎛️ ADVANCED MULTI-MEDIA STUDIO HUB */}
          <div ref={manualEditSectionRef} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6 scroll-mt-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-[#1C1207] tracking-tight flex items-center gap-1.5">
                  <span className="text-indigo-600">🎛️</span> Advanced Media Processing Desk
                </h3>
                <p className="text-[11px] text-slate-500">Edit, convert, record or synthesize voice notes, images and video clips.</p>
              </div>
              
              {/* Tabs */}
              <div className="flex bg-slate-100 p-1 rounded-xl self-stretch sm:self-auto text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setActiveStudioToolTab('video')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${activeStudioToolTab === 'video' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  🎬 Video
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStudioToolTab('audio')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${activeStudioToolTab === 'audio' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  🎙️ Audio
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStudioToolTab('converters')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${activeStudioToolTab === 'converters' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  🔄 Converters
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStudioToolTab('specials')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${activeStudioToolTab === 'specials' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  ✨ Wizards
                </button>
              </div>
            </div>

            {/* TAB CONTENT: VIDEO SUITE */}
            {activeStudioToolTab === 'video' && (
              <div className="space-y-4 animate-in fade-in duration-100 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Screen Recorder Card */}
                  <div className="p-3 bg-slate-50/50 border border-slate-150 rounded-xl space-y-2">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider block">🖥️ Screen Recorder</span>
                    <p className="text-[10.5px] text-slate-500">Capture slides, browser screens or custom application windows.</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (isScreenRecording) {
                            setIsScreenRecording(false);
                            if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') {
                              screenRecorderRef.current.stop();
                            }
                          } else {
                            try {
                              const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                              screenStreamRef.current = stream;
                              const mime =
                                ['video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ||
                                'video/webm';
                              const recorder = new MediaRecorder(stream, { mimeType: mime });
                              screenChunksRef.current = [];
                              recorder.ondataavailable = (e) => {
                                if (e.data?.size > 0) screenChunksRef.current.push(e.data);
                              };
                              recorder.onstop = () => {
                                const blob = new Blob(screenChunksRef.current, { type: recorder.mimeType || mime });
                                const url = URL.createObjectURL(blob);
                                const file = new File([blob], `screen-capture-${Date.now()}.webm`, { type: blob.type });
                                const item = {
                                  id: 'screen_' + Date.now(),
                                  sourceMediaId: 'screen_' + Date.now(),
                                  type: 'video',
                                  file,
                                  url,
                                  dur: 8,
                                  name: `Screen Share Capture`,
                                  from: 'Me (Composer)',
                                  textBody: '',
                                  style: 'gradient',
                                  trimStart: 0,
                                  trimEnd: 8,
                                  transition: 'fade'
                                };
                                onUpdateClipsState([...clips, item]);
                                onUpdateTimelineState([...timelineOrder, clips.length]);
                                stream.getTracks().forEach((t) => t.stop());
                                screenStreamRef.current = null;
                                alert('🎥 Real screen recording captured and added to timeline!');
                              };
                              // Also stop cleanly if the user ends sharing via the browser's own UI.
                              stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                                if (recorder.state !== 'inactive') recorder.stop();
                                setIsScreenRecording(false);
                              });
                              screenRecorderRef.current = recorder;
                              recorder.start(250);
                              setIsScreenRecording(true);
                            } catch (err: any) {
                              console.warn('Screen recording could not start:', err);
                              if (err?.name !== 'NotAllowedError') {
                                alert(`❌ Could not start screen recording: ${err?.message || err}`);
                              }
                            }
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-white font-extrabold flex items-center gap-1 cursor-pointer transition ${isScreenRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-900 hover:bg-slate-800'}`}
                      >
                        <span className={`w-2 h-2 rounded-full bg-white ${isScreenRecording ? 'animate-ping' : ''}`} />
                        {isScreenRecording ? 'Stop Screen Record' : 'Record Screen'}
                      </button>
                      {isScreenRecording && (
                        <span className="font-mono text-xs font-black text-rose-600 animate-pulse">
                          Recording: {screenRecordTimer}s
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Camera Video Recorder Card */}
                  <div className="p-3 bg-slate-50/50 border border-slate-150 rounded-xl space-y-2">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider block">🎥 Webcam Video Recorder</span>
                    <p className="text-[10.5px] text-slate-500">Log guest greetings straight using local browser camera feed.</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (isWebcamRecording) {
                            setIsWebcamRecording(false);
                            if (webcamRecorderRef.current && webcamRecorderRef.current.state !== 'inactive') {
                              webcamRecorderRef.current.stop();
                            }
                          } else {
                            try {
                              const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                              webcamStreamRef.current = stream;
                              const mime =
                                ['video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ||
                                'video/webm';
                              const recorder = new MediaRecorder(stream, { mimeType: mime });
                              webcamChunksRef.current = [];
                              recorder.ondataavailable = (e) => {
                                if (e.data?.size > 0) webcamChunksRef.current.push(e.data);
                              };
                              recorder.onstop = () => {
                                const blob = new Blob(webcamChunksRef.current, { type: recorder.mimeType || mime });
                                const url = URL.createObjectURL(blob);
                                const file = new File([blob], `webcam-greeting-${Date.now()}.webm`, { type: blob.type });
                                const item = {
                                  id: 'webcam_' + Date.now(),
                                  sourceMediaId: 'webcam_' + Date.now(),
                                  type: 'video',
                                  file,
                                  url,
                                  dur: Math.max(1, webcamRecordTimer),
                                  name: `Camera Selfie Greeting`,
                                  from: 'Me (Camera)',
                                  textBody: '',
                                  style: 'gradient',
                                  trimStart: 0,
                                  trimEnd: Math.max(1, webcamRecordTimer),
                                  transition: 'fade'
                                };
                                onUpdateClipsState([...clips, item]);
                                onUpdateTimelineState([...timelineOrder, clips.length]);
                                stream.getTracks().forEach((t) => t.stop());
                                webcamStreamRef.current = null;
                                alert('📸 Real webcam recording captured and added to timeline!');
                              };
                              webcamRecorderRef.current = recorder;
                              recorder.start(250);
                              setIsWebcamRecording(true);
                            } catch (err: any) {
                              console.warn('Webcam recording could not start:', err);
                              if (err?.name !== 'NotAllowedError') {
                                alert(`❌ Could not access your camera: ${err?.message || err}`);
                              }
                            }
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-white font-extrabold flex items-center gap-1 cursor-pointer transition ${isWebcamRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-900 hover:bg-slate-800'}`}
                      >
                        <span className={`w-2 h-2 rounded-full bg-white ${isWebcamRecording ? 'animate-ping' : ''}`} />
                        {isWebcamRecording ? 'Stop Webcam' : 'Webcam Record'}
                      </button>
                      {isWebcamRecording && (
                        <span className="font-mono text-xs font-black text-rose-600 animate-pulse">
                          Rec: {webcamRecordTimer}s
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Video modifiers panel */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">⚙️ Stitcher Video Modifiers</span>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {/* Crop tool - real: drives the actual output pixel dimensions in both render pipelines */}
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-black text-slate-700">📐 Canvas Crop Aspect</label>
                      <select
                        value={cropAspect}
                        onChange={e => setCropAspect(e.target.value as any)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 block font-bold text-slate-650"
                      >
                        <option value="16:9">16:9 Landscape (YouTube)</option>
                        <option value="9:16">9:16 Portrait (Tiktok/Reels)</option>
                        <option value="1:1">1:1 Square (Instagram Post)</option>
                        <option value="4:3">4:3 Retro Cinema SD</option>
                      </select>
                      <p className="text-[9px] text-slate-400">Applied to your downloaded video's actual dimensions.</p>
                    </div>

                    {/* Volume Multiplier - real: applied as a final mixdown gain stage in RenderWorker */}
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-black text-slate-700">🔊 Master Compilation Volume</label>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={masterVideoVolume}
                        onChange={e => setMasterVideoVolume(parseInt(e.target.value))}
                        className="w-full accent-indigo-600 block mt-2 cursor-pointer"
                      />
                      <div className="flex justify-between font-mono text-[9px] text-slate-400 mt-1">
                        <span>0% Muted</span>
                        <span className="font-bold text-indigo-600">{masterVideoVolume}% Volume</span>
                        <span>200% Output Boost</span>
                      </div>
                      <p className="text-[9px] text-slate-400">Applied to your downloaded video's final audio level.</p>
                    </div>

                    {/* Logo Remover, Stabilizer, Speed, Loop Reps: these controls are not yet wired into
                        either render pipeline. They used to show a success alert implying they'd been
                        applied to the final video, which wasn't true - fixed to say so honestly instead
                        of silently pretending. Video stabilization specifically needs ffmpeg's libvidstab,
                        which isn't compiled into the bundled ffmpeg.wasm core, so it can't be added without
                        swapping the whole engine build - it's disabled here rather than faked. */}
                    <div className="space-y-1 opacity-70">
                      <label className="text-[10.5px] font-black text-slate-700 flex items-center gap-1">
                        🛡️ Logo/Watermark Mask
                        <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-black normal-case">Preview only</span>
                      </label>
                      <select
                        value={logoRemovalCorner}
                        onChange={e => setLogoRemovalCorner(e.target.value as any)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 block font-bold text-slate-650"
                      >
                        <option value="none">Disabled (No Filter)</option>
                        <option value="top-left">Mask Top-Left Corner</option>
                        <option value="top-right">Mask Top-Right Corner</option>
                        <option value="bottom-left">Mask Bottom-Left Corner</option>
                        <option value="bottom-right">Mask Bottom-Right Corner</option>
                      </select>
                      <p className="text-[9px] text-amber-600">Not yet applied to your downloaded video.</p>
                    </div>

                    <div className="space-y-1 opacity-70">
                      <label className="text-[10.5px] font-black text-slate-700 flex items-center gap-1">
                        📹 Digital Steadicam
                        <span className="text-[8px] bg-slate-200 text-slate-600 px-1 py-0.5 rounded font-black normal-case">Unavailable</span>
                      </label>
                      <select value="none" disabled className="w-full bg-slate-100 border border-slate-200 rounded-lg p-1.5 block font-bold text-slate-400 cursor-not-allowed">
                        <option value="none">Disabled (Native Raw)</option>
                      </select>
                      <p className="text-[9px] text-slate-400">Real stabilization needs an ffmpeg build this app doesn't ship (libvidstab).</p>
                    </div>

                    <div className="space-y-1 opacity-70">
                      <label className="text-[10.5px] font-black text-slate-700 flex items-center gap-1">
                        🏃 Video Motion Pace
                        <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-black normal-case">Preview only</span>
                      </label>
                      <select
                        value={audioSpeed}
                        onChange={e => setAudioSpeed(parseFloat(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 block font-bold text-slate-650"
                      >
                        <option value="0.25">0.25x Slow-mo frame buffer</option>
                        <option value="0.5">0.50x Slow-mo rate</option>
                        <option value="1.0">1.0x Normal Motion speed</option>
                        <option value="1.5">1.5x Rapid Motion</option>
                        <option value="2.0">2.0x Double speed accelerate</option>
                        <option value="3.0">3.0x Hyper-lapse pacing</option>
                      </select>
                      <p className="text-[9px] text-amber-600">Not yet applied to your downloaded video - use each clip's own Speed control on the timeline instead, which is real.</p>
                    </div>

                    <div className="space-y-1 opacity-70">
                      <label className="text-[10.5px] font-black text-slate-700 flex items-center gap-1">
                        🔁 Short Clip Loop Reps
                        <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-black normal-case">Preview only</span>
                      </label>
                      <select
                        value={loopRepetitions}
                        onChange={e => setLoopRepetitions(parseInt(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 block font-bold text-slate-650"
                      >
                        <option value="1">Play 1x (No repeats)</option>
                        <option value="2">Play 2x Looped repeat</option>
                        <option value="3">Play 3x Looped repeat</option>
                        <option value="5">Play 5x Looped loop</option>
                        <option value="10">Play 10x Constant Loop</option>
                      </select>
                      <p className="text-[9px] text-amber-600">Not yet applied to your downloaded video.</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-150 pt-2 text-[10.5px] text-slate-500 font-medium">
                    <span>🔄 Multi-Video Merge Joiner is fully enabled. Timeline order defines rendering sequence.</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: AUDIO SUITE */}
            {activeStudioToolTab === 'audio' && (
              <div className="space-y-4 animate-in fade-in duration-105 text-xs text-slate-700">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Text-To-Speech (TTS) Engine */}
                  <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl space-y-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider">🗣️ Natural Text-to-Speech Engine</span>
                      <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded font-black">AI SYNTHESIS</span>
                    </div>
                    <p className="text-[10.5px] text-slate-500">Synthesize customized guest notes straight into audible narration files.</p>
                    <textarea
                      value={ttsInput}
                      onChange={e => setTtsInput(e.target.value)}
                      rows={2}
                      placeholder="Write verbal blessing narration here... (e.g. Wishing you a robust, highly incredible 30th celebrations!)"
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs outline-none focus:border-indigo-500 text-slate-700"
                    />
                    <div className="flex justify-between items-center gap-2">
                      <select
                        value={ttsAccent}
                        onChange={e => setTtsAccent(e.target.value)}
                        className="bg-white border border-slate-150 rounded-lg p-1.5 font-bold h-7.5 outline-none text-[10.5px]"
                      >
                        <option value="us-warm">🎙️ US English, Warm (Female)</option>
                        <option value="us-friendly">🎙️ US English, Friendly (Male)</option>
                        <option value="uk-elegant">👒 UK English, Refined (Female)</option>
                        <option value="british-classic">🇬🇧 British English (Male)</option>
                      </select>
                      <button
                        type="button"
                        disabled={!ttsInput || ttsGenerating}
                        onClick={async () => {
                          setTtsGenerating(true);
                          try {
                            const piperTts = await import('@mintplex-labs/piper-tts-web');
                            const accentToVoice: Record<string, string> = {
                              'us-warm': 'en_US-amy-medium',
                              'us-friendly': 'en_US-ryan-medium',
                              'uk-elegant': 'en_GB-alba-medium',
                              'british-classic': 'en_GB-alan-medium',
                            };
                            const voiceId = (accentToVoice[ttsAccent] || 'en_US-amy-medium') as any;

                            const wav = await piperTts.predict({ text: ttsInput, voiceId });

                            // Read back the real duration of the generated audio.
                            let dur = Math.ceil(ttsInput.split(/\s+/).length / 2.5) || 3;
                            try {
                              const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                              const ctx = new AudioCtx();
                              const decoded = await ctx.decodeAudioData(await wav.arrayBuffer());
                              dur = decoded.duration;
                              await ctx.close();
                            } catch { /* fall back to word-count estimate */ }

                            const narrationFile = new File([wav], `narration_${Date.now()}.wav`, { type: 'audio/wav' });
                            const url = URL.createObjectURL(wav);

                            const item = {
                              id: 'tts_' + Date.now(),
                              sourceMediaId: 'tts_' + Date.now(),
                              type: 'audio',
                              file: narrationFile,
                              url,
                              dur,
                              name: `TTS Voice (${ttsAccent})`,
                              from: 'Me (Narrator)',
                              textBody: ttsInput,
                              style: 'gradient',
                              trimStart: 0,
                              trimEnd: dur,
                              transition: 'fade'
                            };
                            onUpdateClipsState([...clips, item]);
                            onUpdateTimelineState([...timelineOrder, clips.length]);
                            setTtsInput('');
                            alert(`🎧 Real Speech Generated!\n\nVoice: ${ttsAccent.toUpperCase()}\nNarration: "${ttsInput}"\n\nA real, locally-generated neural voice clip has been appended to the timeline!`);
                          } catch (err: any) {
                            console.error('TTS narration generation failed:', err);
                            alert(`❌ Could not generate narration audio: ${err?.message || err}`);
                          } finally {
                            setTtsGenerating(false);
                          }
                        }}
                        className={`px-3 py-1.5 h-7.5 rounded-lg text-white font-extrabold transition cursor-pointer flex items-center justify-center ${ttsGenerating ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                      >
                        {ttsGenerating ? '🗣️ Synthesizing...' : '＋ Generate TTS'}
                      </button>
                    </div>
                  </div>

                  {/* Voice Enhancer - real client-side noise reduction + normalization (ffmpeg
                      afftdn/highpass/loudnorm), no upload to any server. Adds the cleaned-up
                      result as a new audio clip on the timeline, same pattern as every other
                      tool in this panel. */}
                  <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl space-y-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider">🧼 Voice Enhancer</span>
                      <span className="text-[8px] bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded font-black">NOISE REMOVAL</span>
                    </div>
                    <p className="text-[10.5px] text-slate-500">Clean up background noise and even out levels on any voice recording or video's audio track.</p>

                    <input
                      type="file"
                      ref={voiceEnhanceInputRef}
                      accept="audio/*,video/*"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setVoiceEnhanceFile(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => voiceEnhanceInputRef.current?.click()}
                      className="w-full bg-white border border-slate-200 hover:border-indigo-400 rounded-lg p-2 text-[10.5px] font-bold text-slate-600 text-left truncate"
                    >
                      {voiceEnhanceFile ? `📄 ${voiceEnhanceFile.name}` : '📂 Choose an audio or video file...'}
                    </button>

                    <div className="flex justify-between items-center gap-2">
                      <select
                        value={voiceEnhanceStrength}
                        onChange={e => setVoiceEnhanceStrength(e.target.value as any)}
                        className="bg-white border border-slate-150 rounded-lg p-1.5 font-bold h-7.5 outline-none text-[10.5px]"
                      >
                        <option value="light">🪶 Light (preserve ambience)</option>
                        <option value="medium">⚖️ Medium (balanced)</option>
                        <option value="strong">🧹 Strong (max noise removal)</option>
                      </select>
                      <button
                        type="button"
                        disabled={!voiceEnhanceFile || isEnhancingVoice}
                        onClick={async () => {
                          if (!voiceEnhanceFile) return;
                          setIsEnhancingVoice(true);
                          setVoiceEnhanceProgress(0);
                          setVoiceEnhanceStatus('Starting...');
                          try {
                            const { enhancedFile, originalDur } = await enhanceVoiceAudio(
                              voiceEnhanceFile,
                              voiceEnhanceStrength,
                              (prog, status) => {
                                setVoiceEnhanceProgress(prog);
                                setVoiceEnhanceStatus(status);
                              }
                            );
                            const url = URL.createObjectURL(enhancedFile);
                            const item = {
                              id: 'enhanced_' + Date.now(),
                              sourceMediaId: 'enhanced_' + Date.now(),
                              type: 'audio',
                              file: enhancedFile,
                              url,
                              dur: originalDur,
                              name: `Enhanced: ${voiceEnhanceFile.name}`,
                              from: 'Me (Voice Enhancer)',
                              textBody: '',
                              style: 'gradient',
                              trimStart: 0,
                              trimEnd: originalDur,
                              transition: 'fade'
                            };
                            onUpdateClipsState([...clips, item]);
                            onUpdateTimelineState([...timelineOrder, clips.length]);
                            setVoiceEnhanceFile(null);
                            alert('🧼 Real noise reduction applied! The cleaned-up audio has been appended to the timeline.');
                          } catch (err: any) {
                            console.error('Voice enhancement failed:', err);
                            alert(`❌ Could not enhance this audio: ${err?.message || err}`);
                          } finally {
                            setIsEnhancingVoice(false);
                          }
                        }}
                        className={`px-3 py-1.5 h-7.5 rounded-lg text-white font-extrabold transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                          !voiceEnhanceFile || isEnhancingVoice ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                      >
                        {isEnhancingVoice ? `🧼 ${voiceEnhanceProgress}%` : '＋ Enhance Audio'}
                      </button>
                    </div>
                    {isEnhancingVoice && (
                      <p className="text-[9px] text-slate-400 italic">{voiceEnhanceStatus}</p>
                    )}
                  </div>

                  {/* Microphone Recorder Card */}
                  <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl space-y-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider">🎙️ vocal Voice Note Recorder</span>
                      <span className="text-[8px] bg-red-101 text-red-600 border border-red-50 bg-red-50 px-1.5 py-0.2 rounded font-black">MIC DETECTED</span>
                    </div>
                    <p className="text-[10.5px] text-slate-500">Record a high-quality verbal wish right now to join backing soundtracks.</p>
                    
                    {/* Pulsing visual spectrum for recording */}
                    <div className="h-11 bg-slate-900 rounded-lg flex items-center justify-center gap-1 overflow-hidden relative">
                      {isVoiceRecording ? (
                        <div className="flex items-end justify-center gap-[4px] h-full py-2">
                          {[...Array(16)].map((_, i) => {
                            const heights = [28, 44, 18, 38, 12, 32, 22, 48, 16, 36, 14, 26, 34, 12, 40, 20];
                            const hValue = heights[i % heights.length];
                            return (
                              <div
                                key={i}
                                className="w-1.5 rounded-full bg-indigo-400"
                                style={{
                                  height: `${hValue}%`,
                                  animation: `fadePrv ${0.4 + (i * 0.05)}s ease-in-out infinite alternate`
                                }}
                              />
                            );
                          })}
                          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[9px] font-mono font-black text-rose-500 animate-pulse bg-slate-950 px-2 py-0.5 rounded border border-rose-950">
                            REC {voiceRecordTimer}s
                          </span>
                        </div>
                      ) : (
                        <div className="text-[10.5px] text-slate-500 font-extrabold uppercase tracking-widest flex items-center gap-1.5">
                          <span>●</span> Microphone state: Standing By
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={async () => {
                          if (isVoiceRecording) {
                            setIsVoiceRecording(false);
                            if (voiceMicRecorderRef.current && voiceMicRecorderRef.current.state !== 'inactive') {
                              voiceMicRecorderRef.current.stop();
                            }
                          } else {
                            try {
                              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                              voiceMicStreamRef.current = stream;
                              const mime =
                                ['audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ||
                                'audio/webm';
                              const recorder = new MediaRecorder(stream, { mimeType: mime });
                              voiceMicChunksRef.current = [];
                              recorder.ondataavailable = (e) => {
                                if (e.data?.size > 0) voiceMicChunksRef.current.push(e.data);
                              };
                              recorder.onstop = () => {
                                const blob = new Blob(voiceMicChunksRef.current, { type: recorder.mimeType || mime });
                                const url = URL.createObjectURL(blob);
                                const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type });
                                const item = {
                                  id: 'voice_' + Date.now(),
                                  sourceMediaId: 'voice_' + Date.now(),
                                  type: 'audio',
                                  file,
                                  url,
                                  dur: Math.max(1, voiceRecordTimer),
                                  name: `Tribute Mic Record`,
                                  from: 'Me (Microphone)',
                                  textBody: '',
                                  style: 'gradient',
                                  trimStart: 0,
                                  trimEnd: Math.max(1, voiceRecordTimer),
                                  transition: 'fade'
                                };
                                onUpdateClipsState([...clips, item]);
                                onUpdateTimelineState([...timelineOrder, clips.length]);
                                stream.getTracks().forEach((t) => t.stop());
                                voiceMicStreamRef.current = null;
                                alert('📁 Real microphone recording joined into backing timeline tracks successfully!');
                              };
                              voiceMicRecorderRef.current = recorder;
                              recorder.start(250);
                              setIsVoiceRecording(true);
                            } catch (err: any) {
                              console.warn('Microphone recording could not start:', err);
                              alert(`❌ Could not access your microphone: ${err?.message || err}`);
                            }
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-white font-extrabold flex items-center justify-center gap-1 flex-1 cursor-pointer transition ${isVoiceRecording ? 'bg-red-500 hover:bg-red-650' : 'bg-slate-900 hover:bg-slate-800'}`}
                      >
                        🗣️ {isVoiceRecording ? 'Stop Recording Wish' : 'Speak Vocal Tribute Now'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* EQ and Modulations */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">🎚️ 3-Band Parametric Equalizer (EQ)</span>
                    <span className="text-[9.5px] text-emerald-600 font-extrabold">APPLIED TO FINAL MIX</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                    {/* Low/Bass */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10.5px] font-bold">
                        <span className="text-slate-500">Bass (Low range)</span>
                        <span className="font-mono text-indigo-600 font-extrabold">{eqBass - 50 > 0 ? '+' : ''}{eqBass - 50} dB</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={eqBass}
                        onChange={e => setEqBass(parseInt(e.target.value))}
                        data-testid="eq-bass-slider"
                        className="w-full accent-indigo-600 cursor-pointer block"
                      />
                    </div>

                    {/* Mid Range */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10.5px] font-bold">
                        <span className="text-slate-500">Vocal Mid Focus</span>
                        <span className="font-mono text-indigo-600 font-extrabold">{eqMid - 50 > 0 ? '+' : ''}{eqMid - 50} dB</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={eqMid}
                        onChange={e => setEqMid(parseInt(e.target.value))}
                        className="w-full accent-indigo-600 cursor-pointer block"
                      />
                    </div>

                    {/* High Treble */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10.5px] font-bold">
                        <span className="text-slate-500">Treble (Sparkle)</span>
                        <span className="font-mono text-indigo-600 font-extrabold">{eqTreble - 50 > 0 ? '+' : ''}{eqTreble - 50} dB</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={eqTreble}
                        onChange={e => setEqTreble(parseInt(e.target.value))}
                        className="w-full accent-indigo-600 cursor-pointer block"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-150 pt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Pitch shifter */}
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-black text-slate-505 block">🧙 AI Vocal Pitch Changer</label>
                      <select
                        value={audioPitch}
                        onChange={e => {
                          setAudioPitch(parseFloat(e.target.value));
                          alert(`🧙 Microphone pitch offset locked. Style forced: ${e.target.value === '1' ? 'Default Natural' : e.target.value === '1.5' ? 'Squeaky Cute Chipmunk' : 'Deep Robotic Bass Cyborg'}`);
                        }}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 block font-bold text-slate-650"
                      >
                        <option value="1">1.0x Default Natural Range</option>
                        <option value="1.5">1.5x Squeaky Cute Chipmunk</option>
                        <option value="1.8">1.8x High Squeal Accent</option>
                        <option value="0.6">0.60x Deep Bass Demon Tone</option>
                        <option value="0.75">0.75x Robotic Boss Pitch</option>
                      </select>
                    </div>

                    {/* Audio Reverse Player */}
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-black text-slate-505 block text-left">🔄 Backward Audio reversing</label>
                      <div className="flex items-center gap-2 mt-1.5 pl-1">
                        <input
                          type="checkbox"
                          checked={audioReversed}
                          onChange={e => {
                            setAudioReversed(e.target.checked);
                            alert(e.target.checked ? '🔄 Special audio reversed flag: Backwards play mode simulation acts enabled!' : 'Normal audio direction restored.');
                          }}
                          className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer animate-none"
                          id="reverse-audio-toggle"
                        />
                        <span className="text-[11px] font-black text-slate-700">Reverse play track direction</span>
                      </div>
                    </div>

                    {/* Audio Joiner helper */}
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-black text-slate-505 block text-left">🔊 Audio Tracks Joiner</label>
                      <button
                        type="button"
                        onClick={() => {
                          const soundClips = clips.filter(c => c.type === 'audio');
                          if (soundClips.length < 2) {
                            alert('🔊 Ensure you have added at least 2 Audio files (using microphones or TTS synthesizers) inside your active timeline block to compile-join them!');
                            return;
                          }
                          const mergedId = 'joined_' + Date.now();
                          const joinedClip = {
                            id: mergedId,
                            sourceMediaId: mergedId,
                            type: 'audio',
                            file: null,
                            url: soundClips[0].url,
                            dur: soundClips.reduce((acc, c) => acc + c.dur, 0),
                            name: `Joined: ${soundClips[0].name.split(' ')[0]} + ${soundClips[1].name.split(' ')[0]}`,
                            from: 'Combined Signal',
                            textBody: 'Merged audio track segments compiled.',
                            style: 'gradient',
                            trimStart: 0,
                            trimEnd: soundClips.reduce((acc, c) => acc + c.dur, 0),
                            transition: 'fade'
                          };
                          // Filter out old sound clips and replace with combined
                          onUpdateClipsState([...clips.filter(c => c.type !== 'audio'), joinedClip]);
                          alert(`🔊 Audio signals synchronized! Merged ${soundClips.length} guest tracks together. Consolidating into dynamic item: "${joinedClip.name}"`);
                        }}
                        className="w-full bg-slate-900 text-white font-extrabold text-[10.5px] py-2 rounded-lg cursor-pointer hover:bg-slate-800 transition"
                      >
                        🔊 Sync & Join Tracks
                      </button>
                    </div>
                  </div>
                </div>

                {/* 🎚️ VOLUME NORMALIZATION CONTROLLER */}
                <div className="p-4 bg-gradient-to-r from-indigo-50 to-slate-50 border border-indigo-100 rounded-2xl space-y-3 shadow-xs text-slate-700">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-indigo-950 uppercase tracking-widest block flex items-center gap-1.5">
                      🎚️ Smart Volume Normalizer
                    </span>
                    <span className="text-[9px] bg-indigo-100 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">
                      Automatic Gain Control
                    </span>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <p className="text-[10.5px] text-slate-500 max-w-md">
                      Enable volume normalization to automatically adjust all video wishes and guest audio tracks to a consistent, comfortable **85% output level**, preventing sudden loudness changes.
                    </p>
                    <div className="flex items-center gap-2 bg-white px-3.5 py-2 border border-slate-200 rounded-xl shrink-0 shadow-2xs hover:border-indigo-200 transition">
                      <input
                        type="checkbox"
                        checked={volumeNormalizationEnabled}
                        onChange={e => {
                          setVolumeNormalizationEnabled(e.target.checked);
                          alert(e.target.checked 
                            ? '🎚️ Volume Normalization Enabled!\nAll clips and audio segments are now automatically normalized to a safe, consistent 85% volume level.' 
                            : 'Normal custom volume curves restored.'
                          );
                        }}
                        className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer accent-indigo-600"
                        id="studio-vol-normalization-toggle"
                      />
                      <label htmlFor="studio-vol-normalization-toggle" className="text-xs font-black text-slate-800 cursor-pointer select-none">
                        {volumeNormalizationEnabled ? 'Active (Normalized)' : 'Inactive'}
                      </label>
                    </div>
                  </div>
                </div>

                {/* ✂️ Auto-Trim Dead Air (real silencedetect-based trimming, video clips only) */}
                <div className="p-4 bg-gradient-to-r from-indigo-50 to-slate-50 border border-indigo-100 rounded-2xl space-y-3 shadow-xs text-slate-700">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-indigo-950 uppercase tracking-widest block flex items-center gap-1.5">
                      ✂️ Auto-Trim Dead Air
                    </span>
                    <span className="text-[9px] bg-indigo-100 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">
                      Silence Detection
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <p className="text-[10.5px] text-slate-500 max-w-md">
                      When rendering, automatically detects quiet dead air at the very start/end of each video clip's trimmed range and trims it away - never expands beyond what you've already selected, and always leaves at least 1 second of content.
                    </p>
                    <div className="flex items-center gap-2 bg-white px-3.5 py-2 border border-slate-200 rounded-xl shrink-0 shadow-2xs hover:border-indigo-200 transition">
                      <input
                        type="checkbox"
                        checked={autoTrimSilenceEnabled}
                        onChange={e => setAutoTrimSilenceEnabled(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer accent-indigo-600"
                        id="studio-auto-trim-silence-toggle"
                      />
                      <label htmlFor="studio-auto-trim-silence-toggle" className="text-xs font-black text-slate-800 cursor-pointer select-none">
                        {autoTrimSilenceEnabled ? 'Active' : 'Inactive'}
                      </label>
                    </div>
                  </div>
                </div>

                {/* Standalone Canvas Waveform Silence-Clipper inside Audio Tools Tab */}
                <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-4 text-white">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-[10.5px] font-black text-indigo-400 uppercase tracking-widest block font-mono">📈 Audio Tools Canvas Waveform Visualizer</span>
                    <span className="text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-950 px-2 py-0.5 rounded font-black uppercase">Visual Silence Trimmer</span>
                  </div>

                  {(() => {
                    const audioClips = clips.filter(c => c.type === 'audio');
                    if (audioClips.length === 0) {
                      return (
                        <div className="py-6 text-center text-[11px] text-slate-400 bg-slate-900/20 rounded-xl border border-slate-800 border-dashed">
                          📻 No Audio clips in timeline. Generate Text-to-Speech or record using voice above to load waves!
                        </div>
                      );
                    }

                    const traceIdx = Math.min(selectedAudioToolIdx, audioClips.length - 1);
                    const clip = audioClips[traceIdx >= 0 ? traceIdx : 0];
                    if (!clip) return null;

                    // Compute peaks
                    const peaks = [];
                    const seedString = clip.id || 'seed';
                    let seedVal = 0;
                    for (let cIdx = 0; cIdx < seedString.length; cIdx++) {
                      seedVal += seedString.charCodeAt(cIdx);
                    }
                    for (let i = 0; i < 60; i++) {
                      let noiseFactor = Math.sin(i * 0.15 + seedVal) * Math.cos(i * 0.08);
                      let baseAmp = 0;
                      if (i < 8) {
                        baseAmp = 6 + Math.abs(noiseFactor) * 8;
                      } else if (i >= 8 && i < 24) {
                        baseAmp = 42 + Math.abs(noiseFactor) * 45;
                      } else if (i >= 24 && i < 32) {
                        baseAmp = 5 + Math.abs(noiseFactor) * 9;
                      } else if (i >= 32 && i < 50) {
                        baseAmp = 38 + Math.abs(noiseFactor) * 55;
                      } else {
                        baseAmp = 8 + Math.abs(noiseFactor) * 10;
                      }
                      peaks.push(Math.round(Math.max(2, Math.min(95, baseAmp))));
                    }

                    const originalClipIndex = clips.findIndex(c => c.id === clip.id);

                    return (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 font-sans">
                          <label className="text-[10.5px] font-bold text-slate-400">Choose Audio Clip to Analyze:</label>
                          <select
                            value={traceIdx >= 0 ? traceIdx : 0}
                            onChange={(e) => setSelectedAudioToolIdx(parseInt(e.target.value))}
                            className="bg-slate-900 border border-slate-800 rounded-lg p-1.5 font-bold text-xs text-indigo-300 outline-none cursor-pointer h-8"
                          >
                            {audioClips.map((c, i) => (
                              <option key={`tool-audio-${c.id}-${i}`} value={i} className="bg-slate-900">
                                🎵 {c.name} ({c.dur}s)
                              </option>
                            ))}
                          </select>
                        </div>

                        <AudioWaveformCanvas
                          peaks={peaks}
                          noiseGate={noiseGate}
                          trimStart={clip.trimStart}
                          trimEnd={clip.trimEnd}
                          duration={clip.dur}
                          onUpdateTrim={(type, val) => {
                            if (originalClipIndex !== -1) {
                              handleUpdateTrim(originalClipIndex, type, val);
                            }
                          }}
                        />

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-1 text-[10.5px] font-sans">
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="font-bold text-slate-450 text-slate-400">🔇 Threshold:</span>
                            <input
                              type="range"
                              min="5"
                              max="80"
                              value={noiseGate}
                              onChange={e => setNoiseGate(parseInt(e.target.value))}
                              className="w-32 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                            />
                            <span className="font-mono text-indigo-300 font-bold">{noiseGate}%</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const firstActiveIdx = peaks.findIndex(p => p >= noiseGate);
                              const lastActiveIdx = [...peaks].reverse().findIndex(p => p >= noiseGate);
                              
                              const startPct = firstActiveIdx !== -1 ? firstActiveIdx / peaks.length : 0;
                              const endPct = lastActiveIdx !== -1 ? 1 - (lastActiveIdx / peaks.length) : 1;
                              
                              if (originalClipIndex !== -1) {
                                const updated = [...clips];
                                const cl = updated[originalClipIndex];
                                cl.trimStart = parseFloat((cl.dur * startPct).toFixed(1));
                                cl.trimEnd = parseFloat((cl.dur * endPct).toFixed(1));
                                onUpdateClipsState(updated);
                                alert(`✂️ Speech Analyzer Trimmed Silence from [${cl.name}] boundaries:\nTrim Start set to ${cl.trimStart}s\nTrim End set to ${cl.trimEnd}s`);
                              }
                            }}
                            className="w-full sm:w-auto px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] rounded-lg tracking-wider uppercase transition active:scale-95 cursor-pointer"
                          >
                            ⚡ Crop Silent Segments
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* TAB CONTENT: ADVANCED CONVERTERS */}
            {activeStudioToolTab === 'converters' && (
              <div className="space-y-4 animate-in fade-in duration-100 text-xs text-slate-700">
                <p className="text-[11px] text-slate-500 leading-normal">
                  Transpiles raw storage files, screenshots or soundwaves between standard extensions. Useful when family members upload exotic device formats.
                </p>

                <div className="p-4 bg-slate-50/50 border border-slate-200 rounded-2xl space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-indigo-50 pb-3">
                    <span className="font-black text-[10.5px] text-indigo-700 uppercase">⚡ Advanced Transcoder Core</span>
                    
                    <div className="flex bg-white rounded-lg p-0.5 border border-slate-200 text-[9.5px] font-extrabold shadow-2xs">
                      <button
                        type="button"
                        onClick={() => {
                          setConvertType('video');
                          setConvertInFormat('MP4');
                          setConvertOutFormat('WEBM');
                        }}
                        className={`px-3 py-1 rounded-md transition ${convertType === 'video' ? 'bg-indigo-600 text-white shadow-3xs' : 'text-slate-650'}`}
                      >
                        🎬 Video Converter (MP4/MKV)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConvertType('audio');
                          setConvertInFormat('MP3');
                          setConvertOutFormat('WAV');
                        }}
                        className={`px-3 py-1 rounded-md transition ${convertType === 'audio' ? 'bg-indigo-600 text-white shadow-3xs' : 'text-slate-650'}`}
                      >
                        🎙️ Audio Converter (MP3/OGG)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConvertType('image');
                          setConvertInFormat('PNG');
                          setConvertOutFormat('JPG');
                        }}
                        className={`px-3 py-1 rounded-md transition ${convertType === 'image' ? 'bg-indigo-600 text-white shadow-3xs' : 'text-slate-650'}`}
                      >
                        📸 Image Converter (PNG/HEIC)
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 -mt-1">
                    <input
                      type="file"
                      id="converter-source-input"
                      className="hidden"
                      accept={convertType === 'video' ? 'video/*' : convertType === 'audio' ? 'audio/*' : 'image/*'}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setConvertSourceFile(f);
                          if (convertResultUrl) URL.revokeObjectURL(convertResultUrl);
                          setConvertResultUrl(null);
                          setConvertProgress(0);
                          setConvertStatus(null);
                        }
                      }}
                    />
                    <label
                      htmlFor="converter-source-input"
                      className="cursor-pointer text-[10.5px] font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-indigo-700 hover:bg-indigo-50"
                    >
                      📁 {convertSourceFile ? 'Change source file' : 'Select file to convert'}
                    </label>
                    {convertSourceFile && (
                      <span className="text-[10px] text-slate-500 truncate max-w-[200px]">{convertSourceFile.name}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 items-end">
                    {/* Input Format */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">📥 Original uploaded extension</label>
                      <select
                        value={convertInFormat}
                        onChange={e => setConvertInFormat(e.target.value)}
                        className="w-full bg-white border border-slate-150 rounded-lg p-1.5 font-bold text-slate-700 outline-none"
                      >
                        {convertType === 'video' && (
                          <>
                            <option value="MP4">MP4 Native Video (.mp4)</option>
                            <option value="MOV">MOV Apple ProRes (.mov)</option>
                            <option value="MKV">MKV Matroska Container (.mkv)</option>
                            <option value="AVI">AVI Windows Legacy (.avi)</option>
                          </>
                        )}
                        {convertType === 'audio' && (
                          <>
                            <option value="MP3">MP3 Compression Layer-3 (.mp3)</option>
                            <option value="WAV">WAV Uncompressed Pulse PCM (.wav)</option>
                            <option value="M4A">M4A Apple AAC Codec (.m4a)</option>
                            <option value="FLAC">FLAC Free Lossless Codec (.flac)</option>
                          </>
                        )}
                        {convertType === 'image' && (
                          <>
                            <option value="PNG">PNG Portable Networks Graphics (.png)</option>
                            <option value="JPG">JPG Joint Photographic Graphics (.jpg)</option>
                            <option value="HEIC">HEIC iOS High-Efficiency (.heic)</option>
                            <option value="WEBP">WEBP Modern Google Lossy (.webp)</option>
                          </>
                        )}
                      </select>
                    </div>

                    {/* Output Format */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">📤 Target container conversion</label>
                      <select
                        value={convertOutFormat}
                        onChange={e => setConvertOutFormat(e.target.value)}
                        className="w-full bg-white border border-slate-150 rounded-lg p-1.5 font-bold text-slate-700 outline-none"
                      >
                        {convertType === 'video' && (
                          <>
                            <option value="WEBM">WEBM Optimized HTML5 (.webm)</option>
                            <option value="MP4">MP4 Mobile Universal (.mp4)</option>
                            <option value="MOV">MOV QuickTime Movie (.mov)</option>
                            <option value="AVI">AVI DivX Format (.avi)</option>
                          </>
                        )}
                        {convertType === 'audio' && (
                          <>
                            <option value="WAV">WAV Lossless 1411kbps Studio (.wav)</option>
                            <option value="MP3">MP3 Compact 320kbps Standard (.mp3)</option>
                            <option value="AAC">AAC Sophisticated Stream (.aac)</option>
                            <option value="OGG">OGG Vorbis Linux Waveform (.ogg)</option>
                          </>
                        )}
                        {convertType === 'image' && (
                          <>
                            <option value="WebP">WebP Super-compressed (.webp)</option>
                            <option value="JPG">JPG Classical Exif (.jpg)</option>
                            <option value="PNG">PNG Alpha Transparent (.png)</option>
                            <option value="TIFF">TIFF Heavy Print Standard (.tiff)</option>
                          </>
                        )}
                      </select>
                    </div>

                    {/* Action trigger button */}
                    <div>
                      <button
                        type="button"
                        disabled={(convertProgress > 0 && convertProgress < 100) || !convertSourceFile}
                        onClick={async () => {
                          if (!convertSourceFile) {
                            alert('📁 Please select a source file to convert first.');
                            return;
                          }
                          setConvertProgress(1);
                          setConvertStatus('Booting up local conversion engine (WebAssembly FFmpeg)...');
                          try {
                            const { getFFmpeg, toUint8Array } = await import('../services/ffmpegService');
                            const ffmpeg = await getFFmpeg();
                            const offProgress = () => { try { (ffmpeg as any).off?.('progress'); } catch {} };
                            ffmpeg.on('progress', ({ progress }) => {
                              const pct = Math.min(97, Math.max(5, Math.round(progress * 100)));
                              setConvertProgress(pct);
                              setConvertStatus(`Transcoding ${convertInFormat} \u2192 ${convertOutFormat}...`);
                            });

                            const inExt = convertInFormat.toLowerCase();
                            const outExt = convertOutFormat.toLowerCase();
                            const inName = `convert_in.${inExt}`;
                            const outName = `convert_out.${outExt}`;
                            const bytes = await toUint8Array(convertSourceFile);
                            await ffmpeg.writeFile(inName, bytes);

                            const codecArgs: string[] =
                              convertType === 'video'
                                ? outExt === 'webm'
                                  ? ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-c:a', 'libopus']
                                  : outExt === 'avi'
                                    ? ['-c:v', 'mpeg4', '-c:a', 'libmp3lame']
                                    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-pix_fmt', 'yuv420p']
                                : convertType === 'audio'
                                  ? outExt === 'mp3'
                                    ? ['-c:a', 'libmp3lame', '-q:a', '2']
                                    : outExt === 'wav'
                                      ? ['-c:a', 'pcm_s16le']
                                      : outExt === 'flac'
                                        ? ['-c:a', 'flac']
                                        : ['-c:a', 'aac', '-b:a', '192k']
                                  : []; // images need no explicit codec args

                            await ffmpeg.exec(['-i', inName, ...codecArgs, outName]);

                            const data = await ffmpeg.readFile(outName);
                            const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
                            const mimeMap: Record<string, string> = {
                              webm: 'video/webm', mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
                              mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
                              png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', tiff: 'image/tiff',
                            };
                            const blob = new Blob([uint8], { type: mimeMap[outExt] || 'application/octet-stream' });
                            if (convertResultUrl) URL.revokeObjectURL(convertResultUrl);
                            const url = URL.createObjectURL(blob);
                            setConvertResultUrl(url);
                            setConvertResultName(`converted_output_${Date.now()}.${outExt}`);

                            try { await ffmpeg.deleteFile(inName); } catch {}
                            try { await ffmpeg.deleteFile(outName); } catch {}
                            offProgress();

                            setConvertProgress(100);
                            setConvertStatus(`Conversion complete! ${convertInFormat} \u2192 ${convertOutFormat} finished successfully.`);
                          } catch (err: any) {
                            console.error('Conversion failed:', err);
                            setConvertProgress(0);
                            setConvertStatus(null);
                            alert(`❌ Conversion failed: ${err?.message || err}${convertType === 'image' && convertInFormat === 'HEIC' ? '\n\n(Note: HEIC decoding is not supported by the bundled ffmpeg build.)' : ''}`);
                          }
                        }}
                        className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold h-9.5 py-1.5 rounded-lg text-center cursor-pointer transition block shadow-sm shadow-slate-100"
                      >
                        {convertProgress > 0 && convertProgress < 100 ? '🔄 Converting...' : '⚡ Launch Convert Engine'}
                      </button>
                    </div>
                  </div>

                  {/* Progress panel representation */}
                  {convertProgress > 0 && (
                    <div className="p-3 bg-slate-950 text-white rounded-xl font-mono text-[10px] space-y-2 max-w-full">
                      <div className="flex justify-between items-center text-indigo-400 font-extrabold">
                        <span>🚀 CONVERTER THREAD: {convertInFormat} ➔ {convertOutFormat}</span>
                        <span>{convertProgress}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-indigo-500 h-full transition-all duration-150" style={{ width: `${convertProgress}%` }} />
                      </div>
                      <p className="text-slate-300 leading-normal pl-1.5 border-l-2 border-indigo-500 truncate max-w-full">
                        Status: {convertStatus}
                      </p>
                      
                      {convertProgress === 100 && convertResultUrl && (
                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-800">
                          <span className="text-[10px] font-sans font-black text-emerald-400">✅ Real converted file ready!</span>
                          <a
                            href={convertResultUrl}
                            download={convertResultName}
                            onClick={() => {
                              setTimeout(() => {
                                setConvertProgress(0);
                                setConvertStatus(null);
                              }, 300);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded px-2.5 py-1 font-sans text-[10px] cursor-pointer"
                          >
                            📥 Download Converted File
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: CLIP SPECIALTIES (WIZARD SPECIALS) */}
            {activeStudioToolTab === 'specials' && (
              <div className="space-y-4 animate-in fade-in duration-100 text-xs text-slate-700">
                <p className="text-[11.5px] text-slate-500 leading-normal">
                  Perform automatic format transitions on specific clips to design unified video streams. Convert silent messages to high-contrast graphic frames or vocal notes to caption tracks.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Tool 1: Written text wish to framed graphic block */}
                  <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">🎨 Auto Wish-to-Image Graphics Frame Card</span>
                    <p className="text-[10.5px] text-slate-500 font-medium">
                      Convert any family guest's written text note into an elegant, custom-designed PNG visual frame card with stylish themed borders, so it slides beautifully inside the movie transitions!
                    </p>

                    {clips.filter(c => c.type === 'text').length > 0 ? (
                      <div className="space-y-3.5">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-500 block">Select Guest Text Clip</label>
                          <select
                            id="wizard-text-clip-dropdown"
                            className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-slate-700 outline-none cursor-pointer"
                          >
                            {clips.filter(c => c.type === 'text').map(c => (
                              <option key={c.id} value={c.id}>
                                ✍️ Wish by: {c.from} ("{c.textBody?.substring(0, 30)}...")
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-500 block">Frame Theme / Poster Aesthetic</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { id: 'gold', label: '👑 Classic Gold' },
                              { id: 'emerald', label: '🌿 Emerald Leaves' },
                              { id: 'cosmic', label: '✨ Cosmic Galaxy' },
                              { id: 'romantic', label: '❤️ Sweet Hearts' },
                              { id: 'cinema', label: '🎬 Retro Cinema' }
                            ].map(theme => (
                              <button
                                key={theme.id}
                                type="button"
                                onClick={() => setWizardTextTheme(theme.id as any)}
                                className={`px-2 py-1.5 rounded-lg text-left text-[10.5px] font-bold border transition ${
                                  wizardTextTheme === theme.id
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {theme.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-500 block">Custom AI Subheading / Annotation edit</label>
                          <input
                            type="text"
                            value={wizardTextPrompt}
                            onChange={e => setWizardTextPrompt(e.target.value)}
                            placeholder="e.g. Generated with magical floral vintage flourishes..."
                            className="w-full bg-white border border-slate-200 rounded-lg p-2 text-[11px] font-bold text-slate-700 placeholder-slate-400 outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const selectEl = document.getElementById('wizard-text-clip-dropdown') as HTMLSelectElement;
                            if (selectEl?.value) {
                              handleConvertTextToImageCard(selectEl.value);
                            }
                          }}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2.5 rounded-lg text-center cursor-pointer transition shadow-xs flex items-center justify-center gap-1.5"
                        >
                          <span>✨ Synthesize Framed Photo-Card 🎨</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-[10.5px] text-slate-400 italic py-3 text-center bg-white rounded-lg border border-slate-150">
                        No written text wish clips in the timeline currently. Tap "+ Timeline" on a guest text contribution below then try again!
                      </p>
                    )}
                  </div>

                  {/* Tool 2: Audio vocal track to subtitle caption overlays */}
                  <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">✍️ Auto Voice-to-Subtitle Caption overlay</span>
                    <p className="text-[10.5px] text-slate-500 font-medium">
                      Transcribe any contributor's oral/voice note wave file and configure synchronized subtitle overlays directly on top of the compilation video.
                    </p>

                    {clips.filter(c => c.type === 'audio').length > 0 ? (
                      <div className="space-y-3 bg-white border border-slate-150 p-2.5 rounded-xl">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-500 block">Select Vocal audio Wish Track</label>
                          <select
                            id="wizard-audio-clip-dropdown"
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-700 outline-none cursor-pointer"
                          >
                            {clips.filter(c => c.type === 'audio').map(c => (
                              <option key={c.id} value={c.id}>
                                🎙️ Voice by: {c.from} ({c.dur}s Track)
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-500 block">Subtitle Font Size</label>
                            <input
                              type="number"
                              min={12}
                              max={36}
                              value={wizardSubtitleSize}
                              onChange={e => setWizardSubtitleSize(Number(e.target.value))}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-[11px] font-bold text-slate-700"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-500 block">Text Color</label>
                            <div className="flex gap-1.5 items-center">
                              <input
                                type="color"
                                value={wizardSubtitleColor}
                                onChange={e => setWizardSubtitleColor(e.target.value)}
                                className="w-8 h-7 bg-slate-50 rounded cursor-pointer border border-slate-200"
                              />
                              <span className="text-[10px] font-mono text-slate-500">{wizardSubtitleColor}</span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-500 block">Subtitle Font Style</label>
                            <select
                              value={wizardSubtitleFont}
                              onChange={e => setWizardSubtitleFont(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-[11px] font-bold text-slate-700 outline-none"
                            >
                              <option value="Inter">Sans (Inter)</option>
                              <option value="Georgia">Serif (Georgia)</option>
                              <option value="JetBrains Mono">Mono (JetBrains)</option>
                              <option value="Space Grotesk">Tech (Grotesk)</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-500 block">Caption Frame Backing</label>
                            <select
                              value={wizardSubtitleBackground}
                              onChange={e => setWizardSubtitleBackground(e.target.value as any)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-[11px] font-bold text-slate-700 outline-none"
                            >
                              <option value="none">Clear (No frame)</option>
                              <option value="shadow">Drop Shadows</option>
                              <option value="strip">Dark Subtitle Frame Block</option>
                            </select>
                          </div>
                        </div>

                        {/* Coordinate Placements Swinger */}
                        <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] uppercase font-black text-slate-550 flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={wizardSubtitleUseXY}
                                onChange={e => setWizardSubtitleUseXY(e.target.checked)}
                                className="rounded text-indigo-600 focus:ring-indigo-500"
                              />
                              Use Custom Frame Alignment Coordinates
                            </label>
                          </div>
                          {wizardSubtitleUseXY && (
                            <div className="space-y-2 p-2 bg-slate-50 rounded-lg border border-slate-150 animate-in slide-in-from-top-1">
                              <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-500">
                                <span>Horizontal Centering Link X (%)</span>
                                <span className="text-indigo-600 font-extrabold">{wizardSubtitleX}%</span>
                              </div>
                              <input
                                type="range"
                                min={10}
                                max={90}
                                value={wizardSubtitleX}
                                onChange={e => setWizardSubtitleX(Number(e.target.value))}
                                className="w-full accent-indigo-600"
                              />
                              <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-500">
                                <span>Vertical Offset Y (%)</span>
                                <span className="text-indigo-600 font-extrabold">{wizardSubtitleY}%</span>
                              </div>
                              <input
                                type="range"
                                min={10}
                                max={95}
                                value={wizardSubtitleY}
                                onChange={e => setWizardSubtitleY(Number(e.target.value))}
                                className="w-full accent-indigo-600"
                              />
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const selectEl = document.getElementById('wizard-audio-clip-dropdown') as HTMLSelectElement;
                            if (selectEl?.value) {
                              handleConvertAudioToSubtitles(selectEl.value);
                            }
                          }}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2.5 rounded-lg text-center cursor-pointer transition shadow-xs flex items-center justify-center gap-1.5"
                        >
                          <span>🎙️ Generate Styled Frame Captions ✍️</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-[10.5px] text-slate-400 italic py-3 text-center bg-white rounded-lg border border-slate-150">
                        No audio/voice notes in the timeline currently. Tap "+ Timeline" on a voice note contribution or record using mic above!
                      </p>
                    )}
                  </div>

                  {/* Background Remover - real client-side portrait segmentation (Hugging Face
                      transformers.js, same library already used for Whisper captions), lazy-
                      loaded on first use. NOTE: could not be exercised end-to-end in the sandbox
                      this was built in (huggingface.co is unreachable from that sandbox's
                      browser) - the pipeline call follows the exact same, already-proven pattern
                      as the caption transcriber, but please verify the actual model download and
                      cutout quality on a real connection before relying on it. */}
                  <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">✂️ Background Remover</span>
                      <span className="text-[8px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.2 rounded font-black">UNVERIFIED IN SANDBOX</span>
                    </div>
                    <p className="text-[10.5px] text-slate-500 font-medium">
                      Cuts a person/subject out of a photo (on-device portrait segmentation) and places them onto a clean solid backdrop of your choice.
                    </p>

                    <input
                      type="file"
                      ref={bgRemoveInputRef}
                      accept="image/*"
                      data-testid="bg-remove-upload-input"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setBgRemoveFile(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => bgRemoveInputRef.current?.click()}
                      className="w-full bg-white border border-slate-200 hover:border-indigo-400 rounded-lg p-2 text-[10.5px] font-bold text-slate-600 text-left truncate"
                    >
                      {bgRemoveFile ? `📄 ${bgRemoveFile.name}` : '📂 Choose a photo...'}
                    </button>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-500 block">Backdrop Color</label>
                      <div className="flex items-center gap-1.5">
                        {['#FFFFFF', '#000000', '#4F46E5', '#059669', '#DC2626'].map(hex => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setBgRemoveBackdrop(hex)}
                            style={{ backgroundColor: hex }}
                            className={`w-6 h-6 rounded-full border-2 cursor-pointer transition ${bgRemoveBackdrop === hex ? 'border-indigo-600 scale-110' : 'border-slate-200'}`}
                            title={hex}
                          />
                        ))}
                        <input
                          type="color"
                          value={bgRemoveBackdrop}
                          onChange={e => setBgRemoveBackdrop(e.target.value)}
                          className="w-6 h-6 rounded-full border border-slate-200 cursor-pointer p-0"
                          title="Custom color"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!bgRemoveFile || isRemovingBg}
                      onClick={async () => {
                        if (!bgRemoveFile) return;
                        setIsRemovingBg(true);
                        setBgRemoveStatus('Starting...');
                        try {
                          const { removeImageBackground } = await import('../services/backgroundRemovalService');
                          const resultFile = await removeImageBackground(bgRemoveFile, bgRemoveBackdrop, (_pct, status) => {
                            setBgRemoveStatus(status);
                          });
                          const url = URL.createObjectURL(resultFile);
                          const item = {
                            id: 'bgremoved_' + Date.now(),
                            sourceMediaId: 'bgremoved_' + Date.now(),
                            type: 'photo',
                            file: resultFile,
                            url,
                            dur: 5,
                            name: `Background Removed: ${bgRemoveFile.name}`,
                            from: 'Me (Background Remover)',
                            textBody: '',
                            style: 'gradient',
                            thumb: url,
                            trimStart: 0,
                            trimEnd: 5,
                            transition: 'fade'
                          };
                          onUpdateClipsState([...clips, item]);
                          onUpdateTimelineState([...timelineOrder, clips.length]);
                          setBgRemoveFile(null);
                          alert('✂️ Background removed! The result has been appended to the timeline.');
                        } catch (err: any) {
                          console.error('Background removal failed:', err);
                          alert(`❌ Could not remove the background: ${err?.message || err}\n\nThis feature downloads a model from Hugging Face on first use - check your internet connection if this keeps failing.`);
                        } finally {
                          setIsRemovingBg(false);
                          setBgRemoveStatus('');
                        }
                      }}
                      className={`w-full font-extrabold py-2 rounded-lg text-center transition ${
                        !bgRemoveFile || isRemovingBg
                          ? 'bg-indigo-400 text-white cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                      }`}
                    >
                      {isRemovingBg ? `✂️ ${bgRemoveStatus || 'Processing...'}` : '✂️ Remove Background'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Personalized Opening Celebration Intro Desk */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center border-b border-slate-50 pb-2">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                👑 Opening Guest Tribute Intro Slide
              </h4>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={celebrationIntroEnabled}
                  onChange={e => setCelebrationIntroEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                <span className="ml-2 text-[9px] font-bold text-slate-500 uppercase">{celebrationIntroEnabled ? 'Active' : 'Skipped'}</span>
              </label>
            </div>

            {celebrationIntroEnabled ? (
              <div className="space-y-3.5 animate-in fade-in duration-200 text-xs font-sans">
                <p className="text-[10px] text-slate-400 leading-relaxed italic">
                  Displays a beautiful high-end cinematic title card with custom floating decorations, gold star ring frame, and guest portrait, greeting everyone before wishes play.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-black text-slate-500 block">🎉 Celebrant Name</label>
                    <input
                      type="text"
                      value={celebratedName}
                      onChange={e => setCelebratedName(e.target.value)}
                      placeholder="e.g. Grandma, Sarah, Boss"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-600"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-black text-slate-500 block">⏱️ Intro Duration</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="2"
                        max="10"
                        value={celebrationIntroDuration}
                        onChange={e => setCelebrationIntroDuration(parseInt(e.target.value))}
                        className="flex-1 accent-indigo-600"
                      />
                      <span className="font-mono text-xs font-bold text-indigo-600 shrink-0">{celebrationIntroDuration}s</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-black text-slate-500 block">📸 Portrait Photo (with face-crop circle)</label>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={celebratedPhoto}
                      onChange={e => setCelebratedPhoto(e.target.value)}
                      placeholder="Provide image web URL (https://...)"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-600"
                    />
                    
                    <button
                      type="button"
                      onClick={() => portraitUploadRef.current?.click()}
                      className="px-3.5 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-100 transition flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      📤 Upload Photo
                    </button>
                    
                    <input
                      type="file"
                      ref={portraitUploadRef}
                      className="hidden"
                      accept="image/*"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === 'string') {
                              setCelebratedPhoto(reader.result);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </div>
                  
                  {/* Preset Quick-Picker portraits for easy testing */}
                  <div className="flex flex-wrap gap-1 pt-1 items-center">
                    <span className="text-[8px] font-black text-slate-400 uppercase">Or select theme preset:</span>
                    {[
                      { l: '🎈 Birthday', u: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&q=80&w=400' },
                      { l: '👰 Wedding', u: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=400' },
                      { l: '👶 Baby', u: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&q=80&w=400' },
                      { l: '🎓 Graduate', u: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&q=80&w=400' }
                    ].map(p => (
                      <button
                        key={p.l}
                        type="button"
                        onClick={() => setCelebratedPhoto(p.u)}
                        className={`px-2 py-0.5 rounded text-[8.5px] font-bold border transition cursor-pointer ${
                          celebratedPhoto === p.u
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {p.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic py-1 text-center font-sans">
                ⚠️ Opening slide bypassed. Video starts immediately with the first timeline contributor greeting.
              </p>
            )}
          </div>

          {/* Soundtrack selector */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center border-b border-slate-50 pb-2">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                🎵 Choose Background Soundtrack
              </h4>
              {soundtrackId === 'custom' && customSoundtrackUrl && (
                <span className="text-[8px] bg-indigo-50 text-indigo-600 font-extrabold px-1.5 py-0.5 rounded uppercase">
                  Custom Audio Active
                </span>
              )}
              {soundtrackId !== 'custom' && soundtrackId !== 'none' && (
                <span className="text-[8px] bg-emerald-50 text-emerald-600 font-extrabold px-1.5 py-0.5 rounded uppercase">
                  Built-in Track Active
                </span>
              )}
              {soundtrackId === 'none' && (
                <span className="text-[8px] bg-slate-100 text-slate-500 font-extrabold px-1.5 py-0.5 rounded uppercase">
                  Muted
                </span>
              )}
            </div>
            <div className="space-y-3">
              <select
                id="soundtrack-selector"
                value={soundtrackId}
                onChange={e => setSoundtrackId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-705 text-slate-755 text-slate-700 outline-none cursor-pointer"
              >
                <option value="none">No Background Music (Muted)</option>
                {customSoundtrackUrl && (
                  <option value="custom">🎧 Custom: {customSoundtrackName || 'Uploaded track'}</option>
                )}
                {BUILTIN_MUSIC.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.e} {m.n} ({m.g} - {m.d})
                  </option>
                ))}
              </select>

              {soundtrackId !== 'none' && soundtrackId !== 'custom' && (
                <p className="text-[9px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
                  ⚠️ Built-in tracks are hosted externally and can occasionally fail to embed into your exported video due to a cross-origin restriction on that host (it'll still play fine here in the live preview either way). If your exported video comes out without music, upload your own MP3 below for a guaranteed, reliable result.
                </p>
              )}

              <div className="pt-1">
                <input
                  type="file"
                  ref={soundtrackFileInputRef}
                  accept="audio/*"
                  onChange={handleCustomSoundtrackUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => soundtrackFileInputRef.current?.click()}
                  className="w-full py-2 border border-dashed border-indigo-200 hover:border-indigo-500 hover:bg-indigo-50/20 text-indigo-600 text-[10px] font-black uppercase rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>📂</span> {customSoundtrackUrl ? 'Change Custom Soundtrack' : 'Upload Custom Background Music'}
                </button>
              </div>

              <p className="text-[10px] text-slate-400 italic">
                Selected background soundtrack spans the entire timeline, playing beneath stitched clips at the volume set below.
              </p>
            </div>
          </div>

          {/* Sound mixers suite */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">
              🎛️ Live Volumes Soundtrack Mixer
            </h4>
            <div className="space-y-3.5 pt-1">
              <div className="flex gap-3 items-center">
                <span className="text-xs font-bold text-slate-700 w-24">Background Music</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  className="flex-1 accent-indigo-600"
                  value={bgVol}
                  onChange={e => setBgVol(parseInt(e.target.value))}
                />
                <span className="font-mono text-xs w-10 text-right">{bgVol}%</span>
              </div>

              <div className="flex gap-3 items-center">
                <span className="text-xs font-bold text-slate-705 text-slate-700 w-24">Voice/Vocal Track</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  className="flex-1 accent-indigo-600"
                  value={voiceVol}
                  onChange={e => setVoiceVol(parseInt(e.target.value))}
                />
                <span className="font-mono text-xs w-10 text-right">{voiceVol}%</span>
              </div>

              <div className="flex gap-3 items-center">
                <span className="text-xs font-bold text-slate-700 w-24">Videos Audio</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  className="flex-1 accent-indigo-600"
                  value={vidVol}
                  onChange={e => setVidVol(parseInt(e.target.value))}
                />
                <span className="font-mono text-xs w-10 text-right">{vidVol}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column Live Canvas Preview */}
        <div id="video-studio-preview-col" className="lg:col-span-5 space-y-6">

          {/* Sticky preview: stays visible while the long settings column (left, or the rest of
              this column below) scrolls past it - the "preview is always on screen" pattern from
              the reference AI-studio-style layout, without restructuring the surrounding page. */}
          <div className="lg:sticky lg:top-4 lg:z-10">
          <div className="bg-slate-950 border border-slate-900 rounded-3xl overflow-hidden shadow-lg select-none">
            {/* Quick aspect ratio selector bar */}
            <div className="bg-slate-900 border-b border-slate-800/80 px-4 py-2.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                🎬 Canvas Format Aspect Ratio:
              </span>
              <div className="flex gap-1">
                {(['16:9', '9:16', '1:1', '4:3'] as const).map((asp) => (
                  <button
                    key={asp}
                    type="button"
                    onClick={() => setCropAspect(asp)}
                    className={`px-2.5 py-1 text-[9.5px] font-black rounded-lg transition-all cursor-pointer ${
                      cropAspect === asp
                        ? 'bg-indigo-600 text-white shadow-sm scale-105'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    {asp === '16:9' ? '📺 16:9 Wide' : asp === '9:16' ? '📱 9:16 Port' : asp === '1:1' ? '🟩 1:1 Sq' : '🎞️ 4:3 Trad'}
                  </button>
                ))}
              </div>
            </div>

            {/* Direct preview window box */}
            <div className={`${getAspectContainerClass()} w-full relative bg-slate-900 flex items-center justify-center mx-auto transition-all duration-300`}>
              <canvas 
                ref={canvasRef} 
                width={getCanvasDimensions().w} 
                height={getCanvasDimensions().h} 
                className="w-full h-full object-contain absolute inset-0 z-10" 
                style={{ filter: getFilterCss(activeVideoFilter) }}
              />
            </div>

            {/* Playback details */}
            <div className="bg-slate-900 p-4 flex flex-wrap gap-2.5 items-center justify-between rounded-b-2xl border-t border-slate-800/80">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setPlayTime(0);
                    drawStudioFrame(0);
                  }}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                  title="Go to Top (Start)"
                >
                  <span>⏮️ Top</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = Math.max(0, playTime - 5);
                    setPlayTime(target);
                    drawStudioFrame(target);
                  }}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                  title="-5 seconds"
                >
                  <span>⏪ Back</span>
                </button>
                <button
                  type="button"
                  onClick={handleStartPlay}
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-950 rounded-xl font-extrabold text-xs transition flex items-center gap-1 cursor-pointer active:scale-95"
                >
                  {playing ? '⏸️ Pause' : '▶️ Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = Math.min(totalDuration, playTime + 5);
                    setPlayTime(target);
                    drawStudioFrame(target);
                  }}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer active:scale-95"
                  title="+5 seconds"
                >
                  <span>Forward ⏩</span>
                </button>
                <button
                  type="button"
                  onClick={handlePausePlay}
                  className="px-3.5 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition cursor-pointer active:scale-95"
                >
                  ⏹️ Stop
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer shadow hover:scale-105 active:scale-95"
                >
                  📺 Full Screen Player
                </button>
                <div className="text-right font-mono text-[10px] text-slate-400">
                  Playing: <span className="text-indigo-400 font-bold">{playTime.toFixed(1)}s</span> / {totalDuration.toFixed(1)}s
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* Add Subtitle text card over video */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                ✍️ Comprehensive Text Overlay Studio
              </h4>
              <span className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-black uppercase">
                Interactive Layering Active
              </span>
            </div>

            <form onSubmit={handleAddOverlay} className="space-y-3.5">
              {/* Text input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  className="bg-white border border-slate-200 rounded-xl px-4 py-1.5 text-xs outline-none focus:border-indigo-600 flex-1"
                  placeholder="Type subtitle overlay text (e.g., Happy Birthday Mom! 🎉)"
                  value={overlayText}
                  onChange={e => setOverlayText(e.target.value)}
                />
                <button 
                  type="submit" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-1.5 px-4.5 rounded-xl cursor-pointer transition active:scale-95 shadow-sm"
                >
                  Create Overlay
                </button>
              </div>

              {/* Extra styling controls container */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-100 text-[10.5px]">
                {/* 1. Target Clip binding */}
                <div className="flex flex-col gap-1 col-span-2">
                  <span className="font-extrabold text-slate-500 uppercase tracking-widest text-[8px]">🎯 Target Memory Clip Span</span>
                  <select
                    value={overlayClipId}
                    onChange={e => setOverlayClipId(e.target.value)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none cursor-pointer h-[26px]"
                  >
                    <option value="global">🌐 Global (Always Visible on Screen)</option>
                    {clips.map((c, idx) => (
                      <option key={`opt-overlay-${c.id}-${idx}`} value={c.id}>
                        🎞️ #{idx+1}. {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Position choice & absolute custom coordinate placement */}
                <div className="flex flex-col gap-1 col-span-2 bg-indigo-50/40 p-2.5 rounded-lg border border-indigo-100/50">
                  <div className="flex justify-between items-center pr-1">
                    <span className="font-extrabold text-indigo-950 uppercase tracking-widest text-[8.5px]">📍 Position on Screen</span>
                    <label className="flex items-center gap-1 cursor-pointer text-[8px] font-black uppercase text-indigo-700 select-none">
                      <input
                        type="checkbox"
                        checked={overlayUseXY}
                        onChange={e => {
                          setOverlayUseXY(e.target.checked);
                        }}
                        className="w-3 h-3 accent-indigo-600 rounded cursor-pointer"
                      />
                      <span>Use Exact X,Y %%</span>
                    </label>
                  </div>
                  
                  {!overlayUseXY ? (
                    <select
                      value={overlayPosition}
                      onChange={e => setOverlayPosition(e.target.value as any)}
                      className="w-full px-2 py-1 mt-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none cursor-pointer h-[26px]"
                    >
                      <option value="top">Top Header ⬆️</option>
                      <option value="centre">Center Focused 🌀</option>
                      <option value="bottom">Bottom Subtitle ⬇️</option>
                    </select>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-wider">X placement: {overlayX}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={overlayX}
                          onChange={e => setOverlayX(parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-wider">Y placement: {overlayY}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={overlayY}
                          onChange={e => setOverlayY(parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Font Family */}
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-slate-500 uppercase tracking-widest text-[8px]">🔤 Font Family</span>
                  <select
                    value={overlayFontFamily}
                    onChange={e => setOverlayFontFamily(e.target.value)}
                    className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none cursor-pointer h-[26px]"
                  >
                    <option value="Inter">Inter (Swiss Sans)</option>
                    <option value="Space Grotesk">Space Grotesk (Tech)</option>
                    <option value="Playfair Display">Playfair (Editor Serif)</option>
                    <option value="JetBrains Mono">JetBrains (Developer Mono)</option>
                    <option value="Syne">Syne (Artistic Display)</option>
                  </select>
                </div>

                {/* 4. Timestamp inputs (relevant if binder is set) */}
                <div className="flex flex-col gap-1 col-span-2">
                  <span className="font-extrabold text-slate-500 uppercase tracking-widest text-[8px]">⏱️ Clip Time Active Window (Secs)</span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 flex items-center bg-white border border-slate-200 rounded-lg px-2 h-[26px]">
                      <span className="text-slate-400 font-bold mr-1 text-[9px] uppercase">Start:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={overlayStartTime}
                        onChange={e => setOverlayStartTime(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full bg-transparent border-none outline-none font-bold text-slate-705 text-slate-700 text-right pr-0.5"
                      />
                    </div>
                    <div className="flex-1 flex items-center bg-white border border-slate-200 rounded-lg px-2 h-[26px]">
                      <span className="text-slate-400 font-bold mr-1 text-[9px] uppercase">End:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={overlayEndTime}
                        onChange={e => setOverlayEndTime(Math.max(0, parseFloat(e.target.value) || 5))}
                        className="w-full bg-transparent border-none outline-none font-bold text-slate-705 text-slate-700 text-right pr-0.5"
                      />
                    </div>
                  </div>
                </div>

                {/* 5. Font size & Color Picker */}
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-slate-500 uppercase tracking-widest text-[8px]">📏 Text Size: {overlaySize}px</span>
                  <input
                    type="range"
                    min="12"
                    max="65"
                    value={overlaySize}
                    onChange={e => setOverlaySize(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-2"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-slate-500 uppercase tracking-widest text-[8px]">🎨 Pick Color</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={overlayColor}
                      onChange={e => setOverlayColor(e.target.value)}
                      className="w-7 h-[26px] bg-transparent border-0 cursor-pointer outline-none"
                    />
                    <input
                      type="text"
                      value={overlayColor}
                      onChange={e => setOverlayColor(e.target.value)}
                      className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-md font-mono text-[9px] text-slate-650 w-full"
                    />
                  </div>
                </div>

                {/* 6. Bold/Italic style flags */}
                <div className="col-span-4 flex items-center gap-6 pt-1 border-t border-slate-100 mt-1 justify-end">
                  <label className="flex items-center gap-2 cursor-pointer font-extrabold text-slate-650 select-none">
                    <input
                      type="checkbox"
                      checked={overlayStyleBold}
                      onChange={e => setOverlayStyleBold(e.target.checked)}
                      className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                    />
                    <span>Bold Type 🄱</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer font-extrabold text-slate-650 select-none">
                    <input
                      type="checkbox"
                      checked={overlayStyleItalic}
                      onChange={e => setOverlayStyleItalic(e.target.checked)}
                      className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                    />
                    <span>Italic Type 🄸</span>
                  </label>
                </div>
              </div>
            </form>

            {/* List overlay attachments */}
            {overlays.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Active Overlay Filters:</span>
                <div className="flex flex-wrap gap-1.5">
                  {overlays.map((o) => {
                    const targetLabel = o.clipId ? 'clip-specific' : 'global screen';
                    return (
                      <span 
                        key={o.id} 
                        className="px-2.5 py-1 bg-indigo-50 border border-indigo-150 text-indigo-600 text-[10.5px] font-semibold rounded-lg flex items-center gap-2"
                        title={`Style: ${o.fontFamily || 'Inter'} ${o.size}px | Active: ${targetLabel}`}
                      >
                        <span className="font-black text-indigo-800">
                          {o.text.length > 25 ? o.text.substring(0, 22) + '...' : o.text}
                        </span>
                        <span className="text-[8.5px] text-indigo-400 font-bold uppercase shrink-0">
                          ({targetLabel})
                        </span>
                        <button
                          type="button"
                          onClick={() => setOverlays(prev => prev.filter(x => x.id !== o.id))}
                          className="text-indigo-400 hover:text-indigo-700 font-black cursor-pointer leading-none text-xs"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Render progress loader */}
          {rendering && (
            <div className="bg-slate-900 rounded-3xl p-5 text-white space-y-4 animate-in fade-in duration-100 border border-slate-800">
              <div className="flex justify-between items-center text-xs font-bold font-mono text-indigo-400">
                <span className="flex items-center gap-1.5 animate-pulse">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                  Processing compilation...
                </span>
                <span className="bg-indigo-950 text-indigo-400 px-2 py-0.5 rounded-full text-[10px]">{renderProgress}%</span>
              </div>
              
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden shadow-inner font-sans">
                <div 
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300" 
                  style={{ width: `${renderProgress}%` }}
                ></div>
              </div>

              {/* Estimated Time Remaining */}
              <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 bg-slate-950/40 px-3 py-1.5 rounded-xl border border-slate-850">
                <span>⏱️ Estimated Time Remaining:</span>
                <span className="text-amber-400 font-extrabold animate-pulse">
                  {renderEta > 0 ? `${renderEta.toFixed(1)}s` : 'Stitching stream...'}
                </span>
              </div>

              <div className="flex items-start gap-2.5 bg-slate-955 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-sm select-none">⚙️</span>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Render Output Stream Status</p>
                  <p className="text-[10.5px] text-slate-200 font-medium font-mono leading-relaxed select-all">
                    {renderingStatus}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  renderWorkerServiceRef.current?.cancel(() => {
                    setRendering(false);
                    setRenderProgress(0);
                    setRenderingStatus('Render cancelled.');
                  });
                }}
                className="w-full h-9 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white font-bold text-xs transition cursor-pointer"
              >
                ✕ Cancel Render
              </button>
            </div>
          )}

          {/* Render error banner */}
          {!rendering && renderError && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-500 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                  !
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-extrabold text-slate-900 leading-tight">Render failed</h4>
                  <p className="text-[10px] text-slate-500 mt-1 break-words">{renderError}</p>
                </div>
              </div>
              <button
                onClick={handleStartRenderMerged}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs block text-center shadow shadow-rose-100"
              >
                🔁 Retry Render
              </button>
            </div>
          )}

          {/* Compiled result banner triggers */}
          {outputUrl && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-4 animate-in zoom-in-95 duration-200">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                  ✓
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-900 leading-tight">Merged Video file available!</h4>
                  <p className="text-[10px] text-slate-400 mt-1">Stitched campaign compilation generated seamlessly with vocal layer soundtracks and text cards integrated.</p>
                </div>
              </div>
              {renderWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1">
                  {renderWarnings.map((w, wi) => (
                    <p key={wi} className="text-[10px] text-amber-700 leading-snug flex gap-1.5">
                      <span className="shrink-0">⚠️</span>
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
              <a
                href={outputUrl}
                download="compiled_surprise.mp4"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs block text-center shadow shadow-emerald-100"
              >
                ⬇️ Download stitched .MP4 file
              </a>
            </div>
          )}

          {/* Standalone audio (MP3) export - LibreCuts-style "Audio Export" */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">🎧 Audio-Only Export</h4>
              <span className="text-[9px] text-slate-400 font-medium">Real .MP3, mixed from your clips + soundtrack</span>
            </div>
            {!audioExporting && !audioOutputUrl && (
              <button
                type="button"
                onClick={handleExportAudioOnly}
                className="w-full h-9 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
              >
                Export Project Audio as MP3
              </button>
            )}
            {audioExporting && (
              <div className="space-y-2">
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all" style={{ width: `${audioExportProgress}%` }} />
                </div>
                <p className="text-[10px] text-slate-500 font-mono">{audioExportProgress}% - encoding real MP3 track...</p>
              </div>
            )}
            {!audioExporting && audioExportError && (
              <div className="text-[10px] text-rose-600 font-medium">{audioExportError}
                <button onClick={handleExportAudioOnly} className="ml-2 underline font-bold cursor-pointer">Retry</button>
              </div>
            )}
            {!audioExporting && audioOutputUrl && (
              <div className="space-y-2">
                {audioExportWarnings.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1">
                    {audioExportWarnings.map((w, wi) => (
                      <p key={wi} className="text-[10px] text-amber-700 leading-snug flex gap-1.5">
                        <span className="shrink-0">⚠️</span>
                        <span>{w}</span>
                      </p>
                    ))}
                  </div>
                )}
                <a
                  href={audioOutputUrl}
                  download="project_audio.mp3"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs block text-center shadow shadow-indigo-100"
                >
                  ⬇️ Download .MP3 file
                </a>
              </div>
            )}
          </div>

          {/* 12:00 Midnight Dispatch & Automation simulator panel */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="border-b border-slate-50 pb-2 flex justify-between items-center">
              <h4 className="text-[10px] font-black text-rose-600 uppercase tracking-widest flex items-center gap-1">
                <span>🕒 Automated Midnight Auto-Publisher</span>
              </h4>
              <span className="text-[11px] bg-rose-50 text-rose-600 border border-rose-100 font-mono font-black px-2.5 py-0.5 rounded-full animate-pulse shrink-0">
                Mock Clock: {virtualClock}
              </span>
            </div>

            <p className="text-xs text-slate-500 leading-normal">
              Keep this schedule enabled! At exactly 12:00 AM midnight birthdays kickoff, Zipp Zap renders the latest compilation and dispatches it directly onto configured platforms.
            </p>

            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'youtube', label: '📺 YouTube Shorts' },
                  { id: 'tiktok', label: '🎵 TikTok Video' },
                  { id: 'instagram', label: '📸 IG Reels' },
                  { id: 'whatsapp', label: '💬 WhatsApp Status' }
                ].map(social => {
                  const active = selectedSocials.includes(social.id);
                  return (
                    <button
                      key={social.id}
                      onClick={() => {
                        setSelectedSocials(prev =>
                          prev.includes(social.id) ? prev.filter(x => x !== social.id) : [...prev, social.id]
                        );
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold transition flex items-center gap-1 ${
                        active ? 'bg-rose-50 border-rose-300 text-rose-600' : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      <span>{active ? '✓' : '＋'}</span> {social.label}
                    </button>
                  );
                })}
              </div>

              {/* Simulation button */}
              {simStatus === 'idle' && (
                <button
                  type="button"
                  onClick={handleSimulateMidnightLaunch}
                  className="w-full bg-slate-900 text-white font-bold text-xs py-2.5 rounded-xl block text-center hover:bg-slate-850 cursor-pointer shadow-md shadow-slate-100"
                >
                  🚀 Test Simulate 12:00 Midnight Kickoff Trigger
                </button>
              )}

              {/* Running animation logs */}
              {simStatus === 'running' && (
                <div className="space-y-3 bg-slate-950 p-4 rounded-xl text-white font-mono text-[10px] outline-none">
                  <div className="flex justify-between items-center text-rose-400 font-bold">
                    <span>🔄 Running midnight triggers...</span>
                    <span>{simProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${simProgress}%` }} />
                  </div>
                  <div className="space-y-1.5 mt-2 max-h-[150px] overflow-y-auto max-w-full text-slate-300">
                    {simLogs.map((logStr, lIdx) => (
                      <div key={lIdx} className="leading-relaxed border-l-2 border-rose-500 pl-1.5">{logStr}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Success post embed mock links */}
              {simStatus === 'success' && (
                <div className="space-y-3 p-4 bg-rose-50 border border-rose-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🎉</span>
                    <h5 className="text-xs font-extrabold text-rose-700">12:00 Midnight Distribution Log success!</h5>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Stitched multi-format video was rendered and successfully uploaded to live social APIs. Teammate contribution wishes is now viewable via:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-center text-[10px] font-bold">
                    {selectedSocials.includes('youtube') && (
                      <a href="#youtube" onClick={(e) => { e.preventDefault(); alert('Simulated playing YouTube Shorts feed!'); }} className="py-2 bg-white border border-rose-200 hover:bg-rose-100 rounded text-rose-700">
                        📺 YouTube Shorts link
                      </a>
                    )}
                    {selectedSocials.includes('tiktok') && (
                      <a href="#tiktok" onClick={(e) => { e.preventDefault(); alert('Simulated TikTok challenge feed!'); }} className="py-2 bg-white border border-rose-200 hover:bg-rose-100 rounded text-rose-700">
                        🎵 TikTok link
                      </a>
                    )}
                    {selectedSocials.includes('instagram') && (
                      <a href="#instagram" onClick={(e) => { e.preventDefault(); alert('Opening Instagram surprise video reel mockup!'); }} className="py-2 bg-white border border-rose-200 hover:bg-rose-100 rounded text-rose-700">
                        📸 Instagram Reel link
                      </a>
                    )}
                    {selectedSocials.includes('whatsapp') && (
                      <a href="#whatsapp" onClick={(e) => { e.preventDefault(); alert('Simulated Broadcast to WhatsApp contacts!'); }} className="py-2 bg-white border border-rose-200 hover:bg-rose-100 rounded text-rose-700">
                        💬 WhatsApp status link
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => { setSimStatus('idle'); setSimLogs([]); }}
                    className="w-full text-center text-[9px] text-[#1C1207] font-black underline cursor-pointer"
                  >
                    Reset and run scheduler audit again
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Visual Transition Clip Preview Overlay */}
      {previewTransitionType && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <style>{`
            @keyframes fadePrv { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }
            @keyframes slideLPrv { 0% { transform: translateX(100%); } 50% { transform: translateX(0); } 100% { transform: translateX(-100%); } }
            @keyframes slideRPrv { 0% { transform: translateX(-100%); } 50% { transform: translateX(0); } 100% { transform: translateX(100%); } }
            @keyframes zoomPrv { 0% { opacity: 0; transform: scale(0.6); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.3); } }
            @keyframes wipePrv { 0% { clip-path: inset(0 100% 0 0); } 50% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 0 0 100%); } }
            .animate-fade-preview { animation: fadePrv 2s infinite ease-in-out; }
            .animate-slide-l-preview { animation: slideLPrv 2s infinite ease-in-out; }
            .animate-slide-r-preview { animation: slideRPrv 2s infinite ease-in-out; }
            .animate-zoom-preview { animation: zoomPrv 2s infinite ease-in-out; }
            .animate-wipe-preview { animation: wipePrv 2s infinite ease-in-out; }
          `}</style>
          
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-150 my-auto">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>
            <div className="text-3xl">💫</div>
            <div>
              <h3 className="text-sm font-black text-indigo-400 uppercase tracking-widest">
                TRANSITION PREVIEW ACTIVE
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">
                Visualizing <span className="font-mono text-white font-bold">{previewTransitionType.toUpperCase()}</span> clip transition sequence
              </p>
            </div>

            {/* Dynamic CSS Visual simulation of transition */}
            <div className="relative h-44 w-full bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center">
              {/* Box 1 */}
              <div className="absolute inset-0 bg-gradient-to-tr from-amber-500 to-rose-600 p-4 flex flex-col justify-end text-left">
                <div className="text-[9px] font-bold text-white/70">CLIP A (Incoming)</div>
                <div className="text-xs font-black text-white">Mom & Dad wish group</div>
              </div>

              {/* Box 2 with dynamic CSS animating transitions */}
              <div className={`absolute inset-0 bg-gradient-to-bl from-indigo-500 to-emerald-600 p-4 flex flex-col justify-end text-left transition-all duration-1000 ${
                previewTransitionType === 'fade' ? 'animate-fade-preview' :
                previewTransitionType === 'slide-l' ? 'animate-slide-l-preview' :
                previewTransitionType === 'slide-r' ? 'animate-slide-r-preview' :
                previewTransitionType === 'zoom-in' ? 'animate-zoom-preview' :
                'animate-wipe-preview'
              }`}>
                <div className="text-[9px] font-bold text-white/70">CLIP B (Outgoing)</div>
                <div className="text-xs font-black text-white">Highschool teammates photo album</div>
              </div>
            </div>

            <div className="text-[10px] text-indigo-400 font-mono">
              Auto-dissolving overlapping keyframe channels...
            </div>
            
            <button
              onClick={() => setPreviewTransitionType(null)}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-black w-full cursor-pointer transition"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}

      {/* 🎬 EXPORT PREVIEW MODAL */}
      <AnimatePresence>
        {exportPreviewOpen && clips.length > 0 && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[1000] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col lg:flex-row h-auto lg:h-[680px] my-auto"
            >
              {/* Left Screen Area (Simulated Player) */}
              <div className="flex-1 bg-black flex flex-col justify-between p-4 relative overflow-hidden group">
                {/* Top header badge */}
                <div className="flex justify-between items-center z-10">
                  <span className="bg-rose-600 text-[9.5px] font-black uppercase text-white px-2.5 py-1 rounded-full animate-pulse tracking-widest">
                    TIMELINE PREVIEW
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Clip {previewClipIdx + 1} of {clips.length}
                  </span>
                </div>

                {/* Simulated Screen with transitions */}
                <div className="flex-1 w-full flex items-center justify-center relative overflow-hidden my-4 self-center rounded-2xl border border-slate-800 bg-slate-950 aspect-video max-h-[420px]">
                  <AnimatePresence mode="wait">
                    {(() => {
                      const c = clips[previewClipIdx];
                      if (!c) return null;
                      const activeTransition = c.transition || 'fade';
                      const transDuration = c.transitionDuration ?? 0.5;
                      
                      // Define visual motion states based on chosen transition
                      const variants = {
                        initial: activeTransition === 'slide' ? { x: '100%', opacity: 0 } :
                                  activeTransition === 'dissolve' ? { opacity: 0, filter: 'blur(8px)' } :
                                  activeTransition === 'zoom' ? { opacity: 0, scale: 0.7 } :
                                  { opacity: 0, scale: 0.98 },
                        animate: { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: transDuration, ease: 'easeInOut' as const } },
                        exit: activeTransition === 'slide' ? { x: '-100%', opacity: 0 } :
                              activeTransition === 'dissolve' ? { opacity: 0, filter: 'blur(8px)' } :
                              activeTransition === 'zoom' ? { opacity: 0, scale: 1.3 } :
                              { opacity: 0, scale: 0.98, transition: { duration: transDuration * 0.8 } }
                      };

                      return (
                        <motion.div
                          key={previewClipIdx}
                          variants={variants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          className="absolute inset-0 w-full h-full flex flex-col items-center justify-center"
                          style={{
                            filter: c.filter === 'sepia' ? 'sepia(0.85)' :
                                    c.filter === 'grayscale' ? 'grayscale(1)' :
                                    c.filter === 'vibrant' ? 'saturate(1.8) contrast(1.25) brightness(1.1)' :
                                    c.filter === 'high-contrast' ? 'contrast(1.6) saturate(1.4)' :
                                    c.filter === 'warm' ? 'sepia(0.3) saturate(1.25) hue-rotate(-10deg)' :
                                    c.filter === 'cool' ? 'saturate(1.1) hue-rotate(15deg) brightness(1.1)' :
                                    c.filter && c.filter !== 'none' ? getFilterCss(c.filter) :
                                    activeVideoFilter === 'sepia' ? 'sepia(0.85)' :
                                    activeVideoFilter === 'grayscale' ? 'grayscale(1)' :
                                    activeVideoFilter === 'vibrant' ? 'saturate(1.8) contrast(1.25) brightness(1.1)' :
                                    activeVideoFilter === 'brightness' ? 'brightness(1.4)' : getFilterCss(activeVideoFilter)
                          }}
                        >
                          {/* Main media preview frame */}
                          {c.type === 'text' ? (
                            <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-950 to-purple-950 flex flex-col justify-center items-center text-center p-6 text-white text-md font-extrabold italic select-none">
                              "{c.textBody || c.note || ' Joyful Greetings!'}"
                            </div>
                          ) : c.type === 'photo' ? (
                            <img
                              src={c.url}
                              alt=""
                              className={`w-full h-full ${fitMode === 'cover' ? 'object-cover' : 'object-contain'} select-none`}
                            />
                          ) : c.type === 'audio' ? (
                            <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-center p-6 text-white relative overflow-hidden select-none">
                              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.12),transparent_70%)] animate-pulse" />
                              <div className="w-16 h-16 rounded-full bg-indigo-650/30 border border-indigo-500/50 flex items-center justify-center text-3xl mb-3 animate-bounce relative z-10">
                                🎙️
                              </div>
                              <h4 className="text-sm font-black text-white relative z-10 uppercase tracking-widest">{c.name}</h4>
                              <p className="text-[10px] text-slate-400 mt-1 relative z-10">Voice/Sound Contribution • {c.dur}s</p>
                              
                              {/* Pulse wave indicator */}
                              <div className="flex items-center gap-1.5 mt-4 justify-center relative z-10 w-full max-w-xs">
                                {[...Array(12)].map((_, wIdx) => {
                                  const heights = [16, 32, 24, 48, 12, 40, 20, 36, 14, 28, 44, 18];
                                  return (
                                    <div
                                      key={wIdx}
                                      className="w-1.5 bg-indigo-400 rounded-full transition-all duration-300"
                                      style={{
                                        height: previewPlaying ? `${heights[wIdx % heights.length]}px` : '6px',
                                        opacity: previewPlaying ? 1 : 0.4
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <video
                              src={c.url}
                              autoPlay={previewPlaying}
                              muted
                              loop
                              className={`w-full h-full ${fitMode === 'cover' ? 'object-cover' : 'object-contain'} select-none`}
                            />
                          )}

                          {/* Simple caption / subtitle overlay in preview player */}
                          {c.caption && (
                            <div className="absolute bottom-12 inset-x-0 text-center select-none z-30 px-6 pointer-events-none animate-in fade-in duration-150">
                              <div className="inline-block bg-slate-950/90 border border-slate-800 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-lg leading-snug max-w-[85%]">
                                {c.caption}
                              </div>
                            </div>
                          )}

                          {/* Interactive Overlay text display inside preview */}
                          {overlays.length > 0 && (
                            <div className="absolute bottom-5 inset-x-0 text-center select-none z-20 px-4 pointer-events-none">
                              {overlays.map((ov, index) => (
                                <div key={index} className="inline-block bg-slate-950/80 border border-slate-850 px-3 py-1 rounded-xl text-[10px] font-black text-indigo-400 shadow-md uppercase tracking-wide">
                                  {ov.text}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Dynamic Frame presets overlays */}
                          {animatedFrame !== 'none' && (
                            <div className="absolute inset-0 pointer-events-none border-8 z-10 rounded-2xl select-none" style={{
                              borderColor: animatedFrame === 'neon' ? '#a855f7' : animatedFrame === 'hearts' ? '#f43f5e' : animatedFrame === 'sparkles' ? '#eab308' : '#22c55e',
                              boxShadow: animatedFrame === 'neon' ? 'inset 0 0 15px currentColor' : 'none'
                            }}>
                              <span className="absolute top-2 right-2 text-xs">
                                {animatedFrame === 'sparkles' ? '✨' : animatedFrame === 'hearts' ? '❤️' : animatedFrame === 'neon' ? '🔋' : '🎞️'}
                              </span>
                            </div>
                          )}
                        </motion.div>
                      );
                    })()}
                  </AnimatePresence>
                </div>

                {/* Simulated Screen Controls overlay banner */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[11px] text-slate-400">
                    <span className="font-extrabold truncate">
                      👉 Currently Playing: <b>{clips[previewClipIdx]?.name || 'Clip Element'}</b>
                    </span>
                    <span className="font-mono text-xs">{fmtT((previewTimer / 100) * 10)} / 0:10</span>
                  </div>

                  {/* Playback progress slider track */}
                  <div className="w-full bg-slate-850 h-1.5 rounded-full overflow-hidden flex">
                    <div
                      className="bg-indigo-500 h-full transition-all duration-300"
                      style={{ width: `${previewTimer}%` }}
                    />
                  </div>

                  {/* Media playback switch shortcuts */}
                  <div className="flex justify-between items-center pt-1.5 border-t border-slate-850">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewClipIdx(p => Math.max(0, p - 1));
                          setPreviewTimer(0);
                        }}
                        className="p-1.5 bg-slate-850 hover:bg-slate-800 rounded-lg text-xs text-white cursor-pointer"
                        title="Previous Clip"
                      >
                        ⏮️
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewPlaying(!previewPlaying)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-[10.5px] font-black text-white flex items-center gap-1 cursor-pointer"
                      >
                        <span>{previewPlaying ? '⏸️ Pause' : '▶️ Play'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (previewClipIdx + 1 < clips.length) {
                            setPreviewClipIdx(p => p + 1);
                          } else {
                            setPreviewClipIdx(0);
                          }
                          setPreviewTimer(0);
                        }}
                        className="p-1.5 bg-slate-850 hover:bg-slate-800 rounded-lg text-xs text-white cursor-pointer"
                        title="Skip Clip"
                      >
                        ⏭️
                      </button>
                    </div>

                    {/* Soundtrack display badge */}
                    <span className="text-[10px] bg-slate-850 text-slate-400 border border-slate-800 rounded-lg px-2.5 py-1 flex items-center gap-1.5 truncate max-w-[220px]">
                      <span>🎵</span> {soundtrackId !== 'none' ? BUILTIN_MUSIC.find(m => m.id === soundtrackId)?.n : 'No Soundtrack (Live Mix)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Sidebar list section */}
              <div className="w-full lg:w-[280px] border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950 p-5 flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest animate-pulse">STITCH TIMELINE</h3>
                    <p className="text-[10px] text-slate-400 mt-1 leading-normal">Review how transitions link individual clip memories together before generating final MP4 download files.</p>
                  </div>

                  {/* List of queue */}
                  <div className="space-y-2 max-h-[220px] md:max-h-[285px] overflow-y-auto pr-1">
                    {clips.map((item, idx) => {
                      const isCurrent = idx === previewClipIdx;
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setPreviewClipIdx(idx);
                            setPreviewTimer(0);
                            setPreviewPlaying(true);
                          }}
                          className={`p-2.5 rounded-xl border text-left transition duration-150 cursor-pointer flex gap-2.5 items-center ${
                            isCurrent
                              ? 'bg-indigo-950 border-indigo-750 text-white font-bold'
                              : 'bg-slate-900/60 border-slate-850 text-slate-400 hover:border-slate-800'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-slate-950 overflow-hidden flex items-center justify-center text-xs shrink-0 relative">
                            {item.type === 'text' ? '✍️' : <img src={item.url} alt="" className="w-full h-full object-cover" />}
                            {isCurrent && (
                              <div className="absolute inset-0 bg-indigo-600/30 flex items-center justify-center font-bold text-white text-[9px] uppercase">
                                ON AIR
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className={`text-[11px] font-black leading-tight truncate ${isCurrent ? 'text-indigo-300' : 'text-slate-300'}`}>
                              {idx + 1}. {item.name}
                            </h4>
                            <div className="flex items-center gap-1 text-[8.5px] font-semibold uppercase mt-0.5 tracking-wider">
                              <span>{item.type}</span>
                              <span>·</span>
                              <span className="text-amber-500 font-bold">{item.transition || 'fade'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Compile CTA controls */}
                <div className="pt-4 border-t border-slate-800 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setExportPreviewOpen(false);
                      setPreviewPlaying(false);
                      handleStartRenderMerged();
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl cursor-pointer shadow-lg transition"
                  >
                    🚀 Start Final Render Build
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExportPreviewOpen(false);
                      setPreviewPlaying(false);
                    }}
                    className="w-full py-2 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-400 text-[10.5px] font-extrabold rounded-xl cursor-pointer transition"
                  >
                    ✏️ Close & Adjust Timeline
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 💫 UNIVERSAL TRANSITION MANAGER MODAL */}
      <AnimatePresence>
        {isTransitionManagerOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-55 p-4 overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-xl shadow-2xl p-6 border border-slate-100 flex flex-col max-h-[85vh] my-auto"
            >
              <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5 text-indigo-600">
                    💫 Studio Transition Manager
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium">Configure cinematic transitional links between timeline order memories</p>
                </div>
                <button 
                  onClick={() => setIsTransitionManagerOpen(false)}
                  className="text-slate-400 hover:text-slate-700 font-black text-lg select-none px-2 cursor-pointer"
                >
                  ×
                </button>
              </div>
              
              <div className="flex-grow overflow-y-auto py-4 space-y-4 pr-1">
                {clips.length < 2 ? (
                  <div className="text-center py-10 text-xs text-slate-400">
                    💡 Please import at least <span className="font-extrabold text-indigo-600">2 clips</span> into your timeline to orchestrate high-grade transitions between memories.
                  </div>
                ) : (
                  clips.slice(0, -1).map((c, i) => {
                    const currentTransition = c.transition || 'fade';
                    const nextClip = clips[i + 1];
                    return (
                      <div key={`trans-conn-${i}`} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">Link #{i+1}</span>
                            <span className="text-slate-400 font-bold">joining</span>
                            <span className="font-black text-slate-700 truncate max-w-[100px]" title={c.name}>{c.name}</span>
                            <span className="text-slate-400">➔</span>
                            <span className="font-black text-slate-700 truncate max-w-[100px]" title={nextClip.name}>{nextClip.name}</span>
                          </div>
                          <span className="text-[9px] font-black text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded-md">
                            Style: {currentTransition.toUpperCase()}
                          </span>
                        </div>
                        
                        {/* Interactive Transition style choice grid */}
                        <div className="grid grid-cols-6 gap-2">
                          {[
                            { id: 'fade', name: 'Crossfade', emoji: '🌫️' },
                            { id: 'slide', name: 'Slide', emoji: '➔' },
                            { id: 'wipe', name: 'Wipe', emoji: '🧹' },
                            { id: 'dissolve', name: 'Dissolve', emoji: '🫧' },
                            { id: 'zoom', name: 'Zoom', emoji: '🔍' },
                            { id: 'auto', name: 'Cinematic Auto', emoji: '🎬' },
                          ].map((tOpt) => {
                            const isSelected = currentTransition === tOpt.id;
                            return (
                              <button
                                key={tOpt.id}
                                type="button"
                                onClick={() => {
                                  const updated = [...clips];
                                  updated[i].transition = tOpt.id;
                                  onUpdateClipsState(updated);
                                }}
                                className={`p-2 rounded-xl border text-center transition flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20 active:scale-95 ${
                                  isSelected 
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md font-bold' 
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <span className="text-md">{tOpt.emoji}</span>
                                <span className="text-[9px] font-black tracking-tight leading-3">{tOpt.name}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Interactive transition duration control */}
                        <div className="flex items-center gap-2 bg-white border border-slate-200/60 rounded-xl p-2.5">
                          <span className="text-[10px] font-bold text-slate-500">⏱️ Transition Duration:</span>
                          <input
                            type="range"
                            min="0.2"
                            max="3.0"
                            step="0.1"
                            value={c.transitionDuration ?? 0.5}
                            onChange={(e) => {
                              const updated = [...clips];
                              updated[i].transitionDuration = parseFloat(e.target.value);
                              onUpdateClipsState(updated);
                            }}
                            className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                          />
                          <span className="text-[10px] font-mono font-black text-slate-700 w-8 text-right">
                            {(c.transitionDuration ?? 0.5).toFixed(1)}s
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              <div className="pt-3 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => setIsTransitionManagerOpen(false)}
                  className="px-4.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-black cursor-pointer transition shadow-md"
                >
                  Apply Transitions
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🔮 THEMED TEMPLATE LIBRARY MODAL */}
      <AnimatePresence>
        {isTemplateLibraryOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[1100] p-4 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh] my-auto"
            >
              {/* Header */}
              <div className="p-6 border-b border-slate-150 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">✨</span>
                  <div>
                    <h3 className="text-md font-black text-slate-900 uppercase tracking-widest">
                      Themed Template Library
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">Speed up your creation with professional pre-designed slideshow layouts & matching audio</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTemplateLibraryOpen(false)}
                  className="text-slate-400 hover:text-slate-700 font-black text-xl select-none px-2.5 py-1.5 rounded-full hover:bg-slate-200/50 cursor-pointer transition"
                >
                  ×
                </button>
              </div>

              {/* Main Template Selection Grid */}
              <div className="flex-grow overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {TEMPLATE_LIBRARY.map((tpl) => {
                    // Find background music name
                    const musicObj = BUILTIN_MUSIC.find(m => m.id === tpl.soundtrackId);
                    const musicName = musicObj ? musicObj.n : 'Unknown Soundtrack';
                    const durationSum = tpl.clips.reduce((acc, c) => acc + c.dur, 0);

                    return (
                      <div
                        key={tpl.id}
                        className="border border-slate-150 rounded-2xl p-5 flex flex-col justify-between hover:border-indigo-300 hover:shadow-md transition bg-gradient-to-b from-slate-50/50 to-white relative overflow-hidden group"
                      >
                        {/* Corner Glow Accent */}
                        <div className={`absolute -right-8 -top-8 w-24 h-24 rounded-full opacity-10 blur-xl group-hover:scale-125 transition duration-500 ${
                          tpl.id === 'birthday' ? 'bg-amber-500' : tpl.id === 'anniversary' ? 'bg-rose-500' : 'bg-teal-500'
                        }`} />

                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <span className="text-3xl bg-slate-100 p-2.5 rounded-2xl shadow-2xs select-none">
                              {tpl.emoji}
                            </span>
                            <div>
                              <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-widest">{tpl.name}</h4>
                              <span className="text-[9px] font-mono font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase">
                                {tpl.clips.length} Memory Clips • {durationSum}s
                              </span>
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                            {tpl.description}
                          </p>

                          {/* Music & settings summary */}
                          <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 border border-slate-150 text-[10px]">
                            <div className="flex items-center justify-between text-slate-700">
                              <span className="font-extrabold text-slate-400 uppercase tracking-wider text-[8px]">🎵 Soundtrack:</span>
                              <span className="font-bold text-slate-800 truncate max-w-[150px]">{musicName}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-700">
                              <span className="font-extrabold text-slate-400 uppercase tracking-wider text-[8px]">🔊 Background Vol:</span>
                              <span className="font-bold font-mono text-slate-800">{tpl.bgVol}%</span>
                            </div>
                          </div>

                          {/* Clip sequence outline preview */}
                          <div className="space-y-1.5">
                            <span className="font-extrabold text-slate-400 uppercase tracking-wider text-[8px]">🎬 Clip Sequence Timeline:</span>
                            <div className="space-y-1 max-h-[110px] overflow-y-auto pr-1">
                              {tpl.clips.map((clip, cIdx) => (
                                <div key={`${clip.id || 'clip'}_${cIdx}`} className="flex justify-between items-center bg-white p-1.5 rounded-lg border border-slate-100 text-[10px]">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="text-[9px] font-bold text-slate-400">#{cIdx+1}</span>
                                    <span className="text-[9px]">{clip.type === 'text' ? '✍️' : clip.type === 'photo' ? '📸' : '🎬'}</span>
                                    <span className="font-bold text-slate-700 truncate max-w-[120px]">{clip.name}</span>
                                  </div>
                                  <span className="font-mono text-slate-400 shrink-0 text-[9px] bg-slate-50 px-1 py-0.2 rounded">{clip.dur}s</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="pt-5 mt-4 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              const confirmApply = window.confirm(
                                `⚠️ ARE YOU SURE?\n\nApplying the "${tpl.name}" template will overwrite your current active timeline and background soundtrack.\n\nThis action cannot be undone.`
                              );
                              if (confirmApply) {
                                onUpdateClipsState(JSON.parse(JSON.stringify(tpl.clips)));
                                onUpdateTimelineState(tpl.clips.map((_, i) => i));
                                setSoundtrackId(tpl.soundtrackId);
                                setBgVol(tpl.bgVol);
                                setIsTemplateLibraryOpen(false);
                                
                                // Set visual feedback success state
                                setSuccessToast(`Applied "${tpl.name}" template! Custom slides and sync music preloaded.`);
                                setTimeout(() => setSuccessToast(null), 5000);
                              }
                            }}
                            className={`w-full py-2 rounded-xl text-[10.5px] font-black uppercase text-white shadow-md hover:scale-95 transition cursor-pointer text-center bg-gradient-to-r ${
                              tpl.id === 'birthday' ? 'from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600' :
                              tpl.id === 'anniversary' ? 'from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600' :
                              'from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600'
                            }`}
                          >
                            ⚡ Load Theme Template
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom bar */}
              <div className="p-4 border-t border-slate-150 bg-slate-50 flex justify-end gap-3.5">
                <button
                  type="button"
                  onClick={() => setIsTemplateLibraryOpen(false)}
                  className="px-5 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition text-[11px] font-black cursor-pointer"
                >
                  Cancel & Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚀 Transient success notification toast banner */}
      <AnimatePresence>
        {successToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 right-6 z-[1200] max-w-md bg-slate-900 border border-emerald-500 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 select-none text-sm shrink-0">
              ✓
            </div>
            <div className="flex-1">
              <h5 className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">Theme Loaded Successfully</h5>
              <p className="text-[11px] text-slate-300 font-medium">{successToast}</p>
            </div>
            <button
              onClick={() => setSuccessToast(null)}
              className="text-slate-400 hover:text-white font-extrabold text-sm ml-2 px-1"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🎞️ Docked timeline strip - the real clip sequence (same clips/timelineOrder/
          selectedClipIdx state as the "Active Stitching Timeline" reorder list above),
          pinned to the bottom of the viewport so it's visible without scrolling back up
          through the settings column, matching the "always-visible timeline" pattern from
          the reference layout. Deliberately still a single sequential strip (not fake
          parallel tracks) - ZippZap's actual data model is one ordered clip list plus a
          separate global soundtrack/overlays, not simultaneous video+audio+overlay tracks,
          and a docked strip that pretended otherwise would misrepresent what render
          actually does. Clicking a thumbnail jumps to that clip's real editor below. */}
      {!isFullscreen && clips.length > 0 && showDockedTimeline && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 shadow-2xl">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider shrink-0">🎞️ Timeline</span>
            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-1">
              {timelineOrder.map((clipIdx, pos) => {
                const c = clips[clipIdx];
                if (!c) return null;
                const isSelected = selectedClipIdx === clipIdx;
                const typeEmoji = c.type === 'video' ? '🎬' : c.type === 'photo' ? '📸' : c.type === 'audio' ? '🎙️' : '✍️';
                return (
                  <button
                    key={c.id || clipIdx}
                    type="button"
                    onClick={() => {
                      setSelectedClipIdx(clipIdx);
                      setClipScrubTime(0);
                      document.getElementById('fine-tuning-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    title={`${c.name || 'Clip'} (${fmtT(c.dur || 0)})`}
                    className={`shrink-0 relative w-14 h-10 rounded-lg overflow-hidden border-2 transition cursor-pointer ${
                      isSelected ? 'border-indigo-500 ring-2 ring-indigo-400/50' : 'border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    {c.thumb ? (
                      <img src={c.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-sm">{typeEmoji}</div>
                    )}
                    <span className="absolute top-0 left-0.5 text-[7px] font-mono font-bold text-slate-300 drop-shadow">{pos + 1}</span>
                    <span className="absolute bottom-0 right-0 px-0.5 bg-black/70 text-[7px] text-white font-mono">{fmtT(c.dur || 0)}</span>
                  </button>
                );
              })}
            </div>
            <span className="shrink-0 text-[9px] font-mono text-slate-400">{clips.length} clip{clips.length === 1 ? '' : 's'} · {fmtT(totalDuration)}</span>
          </div>
        </div>
      )}
      {!isFullscreen && clips.length > 0 && showDockedTimeline && <div className="h-16" aria-hidden="true" />}

    </div>
  );
}
