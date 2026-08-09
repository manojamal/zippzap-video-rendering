import React, { useState, useRef, useEffect } from 'react';
import { MediaItem, CelebrativeEvent } from '../types';
import { PHOTO_FRAMES, SS_TRANSITIONS, BUILTIN_MUSIC, fmtT, SURPRISE_THEMES, getSoundtrackUrl } from '../utils';

interface SlideshowStudioProps {
  media: MediaItem[];
  events?: CelebrativeEvent[];
  onAddNewPhoto: (file: File) => void;
  onClearSlideshowPics: () => void;
  onUsePrebuiltSurpriseAudioSound: (musicId: string) => void;
}

export default function SlideshowStudio({
  media,
  events = [],
  onAddNewPhoto,
  onClearSlideshowPics,
  onUsePrebuiltSurpriseAudioSound
}: SlideshowStudioProps) {
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [frame, setFrame] = useState('none');
  const [transition, setTransition] = useState('fade');
  const [transitionDuration, setTransitionDuration] = useState(0.4);
  const [effect, setEffect] = useState('none');
  const [duration, setDuration] = useState(3);
  const [kenBurns, setKenBurns] = useState('none');
  const [openTitle, setOpenTitle] = useState('');
  const [openSub, setOpenSub] = useState('');
  const [closeText, setCloseText] = useState('');
  const [cardBg, setCardBg] = useState('dark');
  const [musicId, setMusicId] = useState('bm1');

  // Themed Collage states
  const [collageLayout, setCollageLayout] = useState(false);
  const [collageEventId, setCollageEventId] = useState('all');
  const [collageThemeId, setCollageThemeId] = useState('classic');
  const [isDownloadingCollage, setIsDownloadingCollage] = useState(false);

  // Preview properties
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Calculate timelines at the top level
  const opSecs = openTitle ? 3 : 0;
  const clSecs = closeText ? 3 : 0;
  const totalDuration = photos.length * duration + opSecs + clSecs;

  const preloadAllPhotos = async () => {
    if (photos.length === 0) return;
    const preloadPromises = photos.map(p => {
      return new Promise<void>(resolve => {
        if (!p.url) { resolve(); return; }
        if (imageCacheRef.current[p.id]) { resolve(); return; }
        const img = new Image();
        img.onload = () => {
          imageCacheRef.current[p.id] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = p.url;
      });
    });
    await Promise.all(preloadPromises);
  };

  useEffect(() => {
    // Collect all photo items from the general library. Excludes anything
    // explicitly unapproved (approved === false) - unreviewed contributor
    // submissions should never silently show up in an export.
    const list = media.filter(m => m.type === 'photo' && m.approved !== false);
    setPhotos(list);
  }, [media]);

  useEffect(() => {
    preloadAllPhotos();
  }, [photos]);

  const handleSkipForward = () => {
    if (playTime < opSecs) {
      setPlayTime(opSecs);
      drawSlideshowFrame(opSecs);
      return;
    }
    const photoT = playTime - opSecs;
    const i = Math.floor(photoT / duration);
    let target = opSecs + (i + 1) * duration;
    if (target >= opSecs + photos.length * duration) {
      target = opSecs + photos.length * duration;
      if (target >= totalDuration) {
        target = Math.max(0, totalDuration - 0.1);
      }
    }
    setPlayTime(target);
    drawSlideshowFrame(target);
  };

  const handleSkipBackward = () => {
    if (playTime <= opSecs) {
      setPlayTime(0);
      drawSlideshowFrame(0);
      return;
    }
    const photoT = playTime - opSecs;
    const i = Math.floor(photoT / duration);
    const currentPhotoStart = opSecs + i * duration;
    
    let target = 0;
    if (playTime - currentPhotoStart < 0.8 && i > 0) {
      target = opSecs + (i - 1) * duration;
    } else {
      target = currentPhotoStart;
    }
    setPlayTime(target);
    drawSlideshowFrame(target);
  };

  const handleJumpForward = () => {
    const target = Math.min(totalDuration, playTime + 5);
    setPlayTime(target);
    drawSlideshowFrame(target);
  };

  const handleJumpBackward = () => {
    const target = Math.max(0, playTime - 5);
    setPlayTime(target);
    drawSlideshowFrame(target);
  };

  const getCurrentSlideName = () => {
    if (photos.length === 0) return 'No photos';
    if (playTime < opSecs) {
      return `Intro: "${openTitle || 'Greeting'}"`;
    }
    if (closeText && playTime > opSecs + photos.length * duration) {
      return `Outro: "${closeText}"`;
    }
    const photoT = playTime - opSecs;
    const index = Math.min(Math.floor(photoT / duration), photos.length - 1);
    if (index >= 0 && index < photos.length) {
      return `Slide ${index + 1}/${photos.length}: ${photos[index].name}`;
    }
    return 'Preview';
  };

  const handlePhotoUploadLocal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        onAddNewPhoto(files[i]);
      }
    }
  };

  const handleStartPlay = async () => {
    if (photos.length === 0) return;
    if (playing) {
      handleStopPlay();
      return;
    }

    // Cache all photos into browser Image objects before starting the preview
    const preloadPromises = photos.map(p => {
      return new Promise<void>(resolve => {
        if (!p.url) { resolve(); return; }
        if (imageCacheRef.current[p.id]) { resolve(); return; }
        const img = new Image();
        img.onload = () => {
          imageCacheRef.current[p.id] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = p.url;
      });
    });

    await Promise.all(preloadPromises);

    setPlaying(true);
    setPlayTime(0);
    lastTimeRef.current = performance.now();
    animateFrame();
  };

  const handleStopPlay = () => {
    setPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setPlayTime(0);
    drawIdlePlaceholder();
  };

  const animateFrame = () => {
    if (!canvasRef.current) return;
    const now = performance.now();
    const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
    lastTimeRef.current = now;

    const opSecs = openTitle ? 3 : 0;
    const clSecs = closeText ? 3 : 0;
    const totalDuration = photos.length * duration + opSecs + clSecs;

    setPlayTime(prev => {
      const next = prev + dt;
      if (next >= totalDuration) {
        setPlaying(false);
        return 0;
      }
      return next;
    });

    // Request next frame
    animationRef.current = requestAnimationFrame(animateFrame);
  };

  // Draw slideshow preview on Canvas based on current playTime
  const drawSlideshowFrame = (time: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const w = cv.width;
    const h = cv.height;

    // Direct background clear block
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    const opSecs = openTitle ? 3 : 0;
    const clSecs = closeText ? 3 : 0;

    if (openTitle && time < opSecs) {
      // Intro opening panel
      drawIntroOutroTitle(ctx, w, h, openTitle, openSub, cardBg);
    } else if (closeText && time > photos.length * duration + opSecs) {
      // Outro closing card
      drawIntroOutroTitle(ctx, w, h, closeText, '', cardBg);
    } else if (photos.length > 0) {
      const photoT = time - opSecs;
      const index = Math.min(Math.floor(photoT / duration), photos.length - 1);
      const localTime = photoT % duration;
      const photo = photos[index];

      ctx.save();

      // Ken Burns Transform
      if (kenBurns === 'zoom-in') {
        const sc = 1 + (localTime / duration) * 0.12;
        ctx.translate(w / 2, h / 2);
        ctx.scale(sc, sc);
        ctx.translate(-w / 2, -h / 2);
      } else if (kenBurns === 'zoom-out') {
        const sc = 1.12 - (localTime / duration) * 0.12;
        ctx.translate(w / 2, h / 2);
        ctx.scale(sc, sc);
        ctx.translate(-w / 2, -h / 2);
      }

      // Draw Photo
      const img = imageCacheRef.current[photo.id];
      if (img) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const canvasAspect = w / h;
        const imgAspect = iw / ih;

        // Dynamic aspect ratio logic fitting images of various dimensions gracefully
        if (Math.abs(canvasAspect - imgAspect) > 0.05) {
          // If the aspect ratio of the image is different, render a beautiful blurred ambient background
          ctx.filter = 'blur(12px) brightness(45%)';
          const backScale = Math.max(w / iw, h / ih);
          ctx.drawImage(img, (w - iw * backScale) / 2, (h - ih * backScale) / 2, iw * backScale, ih * backScale);
          ctx.filter = 'none';
        }

        // Render foreground preserving the exact ratio centered
        const foreScale = Math.min(w / iw, h / ih);
        const dw = iw * foreScale;
        const dh = ih * foreScale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else {
        // Fallback text drawing
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,.2)';
        ctx.font = '22px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(photo.name, w / 2, h / 2);
      }

      ctx.restore();

      // Apply Frames borders
      applyFrameOnCanvas(ctx, w, h, frame);

      // Transition fade overlay near limits using globally adjustable transitionDuration state
      const transitionTime = transitionDuration;
      if (localTime < transitionTime && transition === 'fade') {
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, 1 - localTime / transitionTime))})`;
        ctx.fillRect(0, 0, w, h);
      } else if (localTime > duration - transitionTime && transition === 'fade') {
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, (localTime - (duration - transitionTime)) / transitionTime))})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  };

  const drawIntroOutroTitle = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    title: string,
    sub: string,
    colorScheme: string
  ) => {
    const bg = colorScheme === 'warm' ? '#C8400A' : colorScheme === 'gold' ? '#5C3A00' : '#111827';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, h / 2 - 10);

    if (sub) {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '18px sans-serif';
      ctx.fillText(sub, w / 2, h / 2 + 30);
    }
  };

  const applyFrameOnCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number, style: string) => {
    if (style === 'white') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 16;
      ctx.strokeRect(8, 8, w - 16, h - 16);
    } else if (style === 'gold') {
      ctx.strokeStyle = '#D4A820';
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, w - 14, h - 14);
    } else if (style === 'vintage') {
      ctx.strokeStyle = '#8B6914';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);
    } else if (style === 'film') {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, 18);
      ctx.fillRect(0, h - 18, w, 18);
    } else if (style === 'animated-stars') {
      // Golden Twinkling Sparkles Border
      const t = performance.now() / 1000;
      ctx.save();
      ctx.strokeStyle = `rgba(212, 168, 32, ${0.4 + Math.sin(t * 4) * 0.2})`;
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, w - 10, h - 10);

      // Draw 8 twinkling stars
      ctx.fillStyle = '#FFD700';
      const points = [
        { x: 40, y: 40 }, { x: w - 40, y: 40 }, { x: w - 40, y: h - 40 }, { x: 40, y: h - 40 },
        { x: w / 2, y: 25 }, { x: w / 2, y: h - 25 }, { x: 25, y: h / 2 }, { x: w - 25, y: h / 2 }
      ];
      points.forEach((pt, idx) => {
        const size = 3 + Math.max(1, 4 + Math.sin(t * 8 + idx) * 3);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pt.x - size * 1.5, pt.y);
        ctx.lineTo(pt.x + size * 1.5, pt.y);
        ctx.moveTo(pt.x, pt.y - size * 1.5);
        ctx.lineTo(pt.x, pt.y + size * 1.5);
        ctx.stroke();
      });
      ctx.restore();
    } else if (style === 'animated-hearts') {
      // Pink Pulsating Beating Hearts Frame
      const t = performance.now() / 1000;
      ctx.save();
      ctx.strokeStyle = `rgba(244, 63, 94, ${0.45 + Math.sin(t * 3.5) * 0.2})`;
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);

      // Center float small emojis around edges
      ctx.font = '15px serif';
      ctx.textAlign = 'center';
      const hearts = [
        { x: 60, y: 35 + Math.sin(t + 1) * 8 },
        { x: w - 60, y: 45 + Math.sin(t + 2) * 8 },
        { x: 75, y: h - 40 + Math.sin(t + 3) * 8 },
        { x: w - 75, y: h - 50 + Math.sin(t + 4) * 8 }
      ];
      hearts.forEach(hItem => {
        ctx.fillText('❤️', hItem.x, hItem.y);
      });
      ctx.restore();
    } else if (style === 'animated-neon') {
      // Dynamic Electric Rainbow Prism Frame
      const t = performance.now() / 1000;
      const deg = (t * 100) % 360;
      ctx.save();
      
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsla(${deg}, 90%, 60%, 1)`);
      grad.addColorStop(0.5, `hsla(${(deg + 120) % 360}, 90%, 65%, 1)`);
      grad.addColorStop(1, `hsla(${(deg + 240) % 360}, 90%, 60%, 1)`);
      
      ctx.strokeStyle = grad;
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.restore();
    }
  };

  /** Draws an image into a box using "cover" semantics (crop to fill, preserve aspect ratio) instead of a naive stretch that distorts faces/subjects. */
  const drawImageCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, dx: number, dy: number, dW: number, dH: number) => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const boxAspect = dW / dH;
    const imgAspect = iw / ih;
    let sx = 0, sy = 0, sw = iw, sh = ih;
    if (imgAspect > boxAspect) {
      // Image is wider than the box - crop the sides.
      sw = ih * boxAspect;
      sx = (iw - sw) / 2;
    } else {
      // Image is taller than the box - crop top/bottom.
      sh = iw / boxAspect;
      sy = (ih - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dW, dH);
  };

  // Live on-screen preview stays at COLLAGE_BASE_W/H (fast to redraw on every state
  // change). Downloads render the identical layout onto an offscreen canvas at
  // COLLAGE_EXPORT_SCALE x that resolution instead, so the exported PNG is sharp
  // full-resolution output rather than a small, blurry preview-canvas grab.
  const COLLAGE_BASE_W = 854;
  const COLLAGE_BASE_H = 480;
  const COLLAGE_EXPORT_SCALE = 3;

  const drawThemedCollage = (targetCv?: HTMLCanvasElement, renderScale: number = 1) => {
    const cv = targetCv || canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const w = cv.width;
    const h = cv.height;
    const rs = renderScale; // multiplies every fixed pixel constant below so the layout scales with canvas resolution

    // Retrieve active theme colors
    const activeTheme = SURPRISE_THEMES.find(t => t.id === collageThemeId) || SURPRISE_THEMES[0];
    const { orange, c1, c2, ink } = activeTheme.colors;

    // Draw premium background gradient using theme colors
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw decorative background sparkles / confetti using theme's primary accent
    ctx.save();
    ctx.fillStyle = orange;
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 40; i++) {
      const pSize = (4 + (i % 5) * 3) * rs;
      const px = (i * 27 * rs) % w;
      const py = (i * 19 * rs) % h;
      ctx.beginPath();
      ctx.arc(px, py, pSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Draw border frame matching theme
    ctx.strokeStyle = orange;
    ctx.lineWidth = 6 * rs;
    ctx.strokeRect(3 * rs, 3 * rs, w - 6 * rs, h - 6 * rs);

    // Filter photos based on event filter
    const activeEvent = events.find(e => e.id === collageEventId);
    const filteredPhotos = collageEventId === 'all'
      ? photos
      : photos.filter(p => p.event === collageEventId || (activeEvent && p.from && p.from !== 'Manager upload'));

    const collagePhotos = filteredPhotos.slice(0, 5);

    // Draw Event Title / Heading matching theme
    ctx.save();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.font = `bold ${24 * rs}px "Space Grotesk", "Inter", sans-serif`;
    const mainTitle = activeEvent ? activeEvent.title : 'SURPRISE MEMORIES COLLECTION';
    ctx.fillText(mainTitle.toUpperCase(), w / 2, 45 * rs);

    ctx.fillStyle = orange;
    ctx.font = `bold ${10 * rs}px "JetBrains Mono", monospace`;
    ctx.fillText(`THEMED ALBUM COLLAGE • PRESST: ${activeTheme.name.toUpperCase()}`, w / 2, 65 * rs);
    ctx.restore();

    if (collagePhotos.length === 0) {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.font = `italic ${12 * rs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('No photos available to collage. Add photos below!', w / 2, h / 2);
      return;
    }

    // Precise preset coordinates for up to 5 scattered cards so they lay out gorgeously
    // (all offsets multiplied by rs so the scatter pattern scales with canvas resolution
    // instead of clustering in a fixed-size area on a larger canvas)
    const layouts = [
      // 1 photo
      [{ x: w / 2, y: h / 2 + 10 * rs, r: 0, s: 1.1 }],
      // 2 photos
      [
        { x: w / 2 - 120 * rs, y: h / 2 + 15 * rs, r: -4, s: 1.0 },
        { x: w / 2 + 120 * rs, y: h / 2 + 15 * rs, r: 5, s: 1.0 }
      ],
      // 3 photos
      [
        { x: w / 2 - 150 * rs, y: h / 2 + 20 * rs, r: -6, s: 0.9 },
        { x: w / 2, y: h / 2 + 10 * rs, r: 2, s: 0.95 },
        { x: w / 2 + 150 * rs, y: h / 2 + 25 * rs, r: 5, s: 0.9 }
      ],
      // 4 photos
      [
        { x: w / 2 - 180 * rs, y: h / 2 + 20 * rs, r: -7, s: 0.8 },
        { x: w / 2 - 60 * rs, y: h / 2 + 10 * rs, r: -2, s: 0.82 },
        { x: w / 2 + 60 * rs, y: h / 2 + 25 * rs, r: 4, s: 0.8 },
        { x: w / 2 + 180 * rs, y: h / 2 + 15 * rs, r: 6, s: 0.82 }
      ],
      // 5 photos
      [
        { x: w / 2 - 190 * rs, y: h / 2 + 25 * rs, r: -8, s: 0.72 },
        { x: w / 2 - 95 * rs, y: h / 2 + 12 * rs, r: -3, s: 0.75 },
        { x: w / 2, y: h / 2 + 22 * rs, r: 1, s: 0.78 },
        { x: w / 2 + 95 * rs, y: h / 2 + 10 * rs, r: 4, s: 0.75 },
        { x: w / 2 + 190 * rs, y: h / 2 + 27 * rs, r: 7, s: 0.72 }
      ]
    ];

    const currentLayout = layouts[collagePhotos.length - 1] || layouts[layouts.length - 1];

    // Caching check - make sure selected collage images are cached
    collagePhotos.forEach(p => {
      if (p.url && !imageCacheRef.current[p.id]) {
        const img = new Image();
        img.onload = () => {
          imageCacheRef.current[p.id] = img;
          drawThemedCollage();
        };
        img.src = p.url;
      }
    });

    // Render each photo card
    collagePhotos.forEach((photo, idx) => {
      const cfg = currentLayout[idx];
      if (!cfg) return;

      const img = imageCacheRef.current[photo.id];
      ctx.save();

      // Translate, rotate, and scale to scattered physical photo position
      ctx.translate(cfg.x, cfg.y);
      ctx.rotate((cfg.r * Math.PI) / 180);

      const scale = cfg.s;
      const cardW = 160 * scale * rs;
      const cardH = 190 * scale * rs;

      // Draw shadow
      ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
      ctx.shadowBlur = 12 * scale * rs;
      ctx.shadowOffsetY = 6 * scale * rs;

      // Draw premium polaroid frame backing
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.lineWidth = 1 * rs;
      ctx.beginPath();
      ctx.rect(-cardW / 2, -cardH / 2, cardW, cardH);
      ctx.fill();
      ctx.stroke();

      // Reset shadow for subsequent drawings inside the card
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Draw image inside frame (leaving polaroid margins)
      const borderM = 10 * scale * rs;
      const bottomM = 35 * scale * rs;
      const picW = cardW - borderM * 2;
      const picH = cardH - borderM - bottomM;
      const picX = -cardW / 2 + borderM;
      const picY = -cardH / 2 + borderM;

      if (img && img.complete && img.naturalWidth > 0) {
        // "Cover" crop instead of a naive stretch - preserves the source photo's
        // aspect ratio and full resolution detail instead of squishing faces or
        // relying on the browser's low-quality scaling for a mismatched box.
        drawImageCover(ctx, img, picX, picY, picW, picH);
      } else {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(picX, picY, picW, picH);
        ctx.fillStyle = '#94a3b8';
        ctx.font = `${8 * scale * rs}px "JetBrains Mono"`;
        ctx.textAlign = 'center';
        ctx.fillText('LOADING IMAGE...', 0, picY + picH / 2);
      }

      // Draw photo writer text label with ink styling
      ctx.fillStyle = '#334155';
      ctx.font = `italic ${10 * scale * rs}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      const authorText = photo.from ? `From ${photo.from.split('(')[0]}` : 'Special Wish';
      ctx.fillText(authorText, 0, cardH / 2 - 12 * scale * rs);

      ctx.restore();
    });
  };

  const handleDownloadCollage = async () => {
    setIsDownloadingCollage(true);
    try {
    const collagePhotos = (collageEventId === 'all' ? photos : photos.filter(p => {
      const activeEvent = events.find(e => e.id === collageEventId);
      return p.event === collageEventId || (activeEvent && p.from && p.from !== 'Manager upload');
    })).slice(0, 5);

    // Make sure every photo in this collage is actually loaded before we render the
    // high-res export - otherwise a slow-loading image would silently export blank.
    await Promise.all(collagePhotos.map(p => new Promise<void>((resolve) => {
      const cached = imageCacheRef.current[p.id];
      if (!p.url || (cached?.complete && cached.naturalWidth > 0)) { resolve(); return; }
      const img = new Image();
      img.onload = () => { imageCacheRef.current[p.id] = img; resolve(); };
      img.onerror = () => resolve(); // don't block the whole export on one broken image
      img.src = p.url;
    })));

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = COLLAGE_BASE_W * COLLAGE_EXPORT_SCALE;
    exportCanvas.height = COLLAGE_BASE_H * COLLAGE_EXPORT_SCALE;
    drawThemedCollage(exportCanvas, COLLAGE_EXPORT_SCALE);

    const dataUrl = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `themed-collage-${collageThemeId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    } finally {
      setIsDownloadingCollage(false);
    }
  };

  const drawIdlePlaceholder = () => {
    if (collageLayout) {
      drawThemedCollage();
      return;
    }
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (photos.length > 0) {
      drawSlideshowFrame(0);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      ctx.font = 'semibold 16px "Instrument Sans",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('📸 Interactive slideshow preview card', cv.width / 2, cv.height / 2);
    }
  };

  // Compile Render generator flow - real capture of the actual composited canvas + soundtrack.
  const handleCompileSlideshow = async () => {
    if (photos.length === 0) return;
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);
    setRenderError(null);
    setRendering(true);
    setRenderProgress(0);

    const cv = canvasRef.current;
    if (!cv || typeof (cv as any).captureStream !== 'function') {
      setRendering(false);
      setRenderError('Your browser does not support recording a live canvas (captureStream). Try an up-to-date Chrome, Edge, or Firefox.');
      return;
    }

    let audioEl: HTMLAudioElement | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      const videoStream: MediaStream = (cv as any).captureStream(30);
      let combinedStream: MediaStream = videoStream;

      const musicUrl = getSoundtrackUrl(musicId, null);
      if (musicUrl) {
        try {
          audioEl = new Audio(musicUrl);
          audioEl.crossOrigin = 'anonymous';
          audioEl.loop = true;
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          audioCtx = new AudioCtx();
          const source = audioCtx.createMediaElementSource(audioEl);
          const dest = audioCtx.createMediaStreamDestination();
          const gain = audioCtx.createGain();
          gain.gain.value = 0.6;
          source.connect(gain).connect(dest);
          await audioEl.play();
          combinedStream = new MediaStream([...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        } catch (audioErr) {
          console.warn('Soundtrack unavailable for this export, continuing without audio:', audioErr);
          if (audioCtx) { try { await audioCtx.close(); } catch { /* ignore */ } audioCtx = null; }
          audioEl = null;
        }
      }

      const mimeType =
        ['video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const recorder = new MediaRecorder(combinedStream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunks.push(e.data);
      };
      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      });

      recorder.start(250);

      const total = Math.max(0.1, totalDuration);
      const startTs = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const elapsed = (performance.now() - startTs) / 1000;
          const t = Math.min(total, elapsed);
          drawSlideshowFrame(t);
          setRenderProgress(Math.min(99, Math.round((t / total) * 100)));
          if (t >= total) {
            resolve();
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });

      recorder.stop();
      if (audioEl) audioEl.pause();
      if (audioCtx) await audioCtx.close().catch(() => {});

      const blob = await finished;
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setRenderProgress(100);
    } catch (err: any) {
      console.error('Slideshow export failed:', err);
      setRenderError(err?.message || 'Slideshow export failed. Please try again.');
      if (audioEl) audioEl.pause();
      if (audioCtx) await audioCtx.close().catch(() => {});
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    if (playing || playTime >= 0) {
      drawSlideshowFrame(playTime);
    }
  }, [playTime, playing]);

  useEffect(() => {
    drawIdlePlaceholder();
  }, [collageLayout, collageThemeId, collageEventId, photos]);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 border-b border-slate-100 pb-2">🖼️ Photo Slideshow Studio</h1>
          <p className="text-xs text-slate-500 mt-1">Design moving picture albums with gorgeous Ken-Burns panning and music overlays</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => uploadInputRef.current?.click()}
            className="px-4 py-2 border border-slate-200 hover:border-indigo-600 bg-white font-extrabold text-slate-700 text-xs rounded-xl transition cursor-pointer"
          >
            ＋ Add Photos
          </button>
          <button
            onClick={handleCompileSlideshow}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow cursor-pointer transition"
          >
            Compile Slideshow ➔
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column tools options */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">📸 Slides Strip ({photos.length})</h3>
              <div className="flex gap-2">
                <input
                  type="file"
                  multiple
                  ref={uploadInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUploadLocal}
                />
                <button onClick={onClearSlideshowPics} className="text-[10px] font-bold text-rose-500 cursor-pointer">
                  Clear Slides
                </button>
              </div>
            </div>

            {/* Photo Strip Slider */}
            <div className="flex gap-2 overflow-x-auto pb-2 select-none min-h-[70px] scrollbar-thin">
              {photos.map((p, i) => (
                <div key={`${p.id}_${i}`} className="relative w-16 h-12 bg-slate-100 rounded-xl overflow-hidden shrink-0 border border-slate-200">
                  {p.url && <img src={p.url} alt={p.name} className="w-full h-full object-cover" />}
                  <div className="absolute bottom-0 left-0 bg-slate-950/70 text-[8px] font-mono text-white px-1">{i + 1}</div>
                </div>
              ))}
              {photos.length === 0 && (
                <div className="text-xs text-slate-400 py-3 w-full text-center">No photos selected. Attach some above!</div>
              )}
            </div>
          </div>

          {/* THEMED COLLAGE LAYOUT SECTION */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-150">
              <div>
                <h3 className="text-xs font-black text-slate-950 uppercase tracking-widest flex items-center gap-1.5">
                  <span>🎨</span> Themed Album Collage Designer
                </h3>
                <p className="text-[10px] text-slate-400">Arrange contributor photo memories into a gorgeous theme-styled scattering grid layout</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={collageLayout}
                  onChange={e => setCollageLayout(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer"
                  id="collage-layout-toggle"
                />
                <label htmlFor="collage-layout-toggle" className="text-xs font-black text-slate-700 cursor-pointer">
                  Activate Collage
                </label>
              </div>
            </div>

            {collageLayout && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-200">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Select Campaign Event</label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none font-medium"
                    value={collageEventId}
                    onChange={e => setCollageEventId(e.target.value)}
                  >
                    <option value="all">All Campaign Photos Combined</option>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>{ev.emoji} {ev.title}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Select Visual Theme</label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 outline-none font-medium"
                    value={collageThemeId}
                    onChange={e => setCollageThemeId(e.target.value)}
                  >
                    {SURPRISE_THEMES.map(theme => (
                      <option key={theme.id} value={theme.id}>{theme.emoji} {theme.name}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-1 sm:col-span-2 pt-2">
                  <button
                    onClick={handleDownloadCollage}
                    disabled={isDownloadingCollage}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow cursor-pointer transition flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    {isDownloadingCollage ? '⏳ Rendering full-resolution PNG...' : '📥 Download High-Res Collage (.PNG)'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Borders & Transitions selector details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">🖼️ Photo Frames style</h4>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'none', name: 'Original 🚫' },
                  { id: 'white', name: 'Premium ⬜' },
                  { id: 'gold', name: 'Gold 🪙' },
                  { id: 'film', name: 'Cinema 🎞️' },
                  { id: 'animated-stars', name: 'Stars ✨' },
                  { id: 'animated-hearts', name: 'Hearts ❤️' },
                  { id: 'animated-neon', name: 'Neon 🌈' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFrame(f.id)}
                    className={`py-2 px-1 text-[9.5px] font-bold rounded-xl border transition cursor-pointer ${
                      frame === f.id
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 shadow-3xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">✨ Slide Transitions</h4>
                <span className="text-[10px] font-bold text-indigo-650 bg-indigo-50 px-2 py-0.5 rounded-full">Global</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SS_TRANSITIONS.slice(0, 6).map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTransition(t.id)}
                    className={`py-2 px-1 text-[10px] font-bold rounded-xl border transition cursor-pointer ${
                      transition === t.id
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>

              {/* Global transition duration slider */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  <span>⏱️ Transition Speed</span>
                  <span className="font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{transitionDuration.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="2.5"
                  step="0.1"
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  value={transitionDuration}
                  onChange={e => setTransitionDuration(parseFloat(e.target.value))}
                />
                <p className="text-[9px] text-slate-400">Adjust the speed of cross-dissolve animations between photo slideshow frames.</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">
              Ken-Burns Effects & open/closing cards details
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Ken Burns movements</label>
                <select
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-900 outline-none"
                  value={kenBurns}
                  onChange={e => setKenBurns(e.target.value)}
                >
                  <option value="none">Off (No Animation)</option>
                  <option value="zoom-in">🔍 Slow Zoom In</option>
                  <option value="zoom-out">🔍 Slow Zoom Out</option>
                  <option value="random">🔄 Pan and Zoom</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  <span>Slide Duration</span>
                  <span className="font-mono text-indigo-600">{duration}s</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  value={duration}
                  onChange={e => setDuration(parseInt(e.target.value))}
                />
              </div>

              <div className="col-span-2 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Intro Opening Title card..."
                    className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-600 w-full"
                    value={openTitle}
                    onChange={e => setOpenTitle(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Intro Subtitle..."
                    className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-600 w-full"
                    value={openSub}
                    onChange={e => setOpenSub(e.target.value)}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Closing Message Outro Card..."
                  className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-600 w-full"
                  value={closeText}
                  onChange={e => setCloseText(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right column Preview block */}
        <div 
          id="ss-preview-col" 
          className={isFullscreen 
            ? "fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between p-6 overflow-hidden animate-in fade-in duration-200" 
            : "lg:col-span-5 space-y-4"
          }
        >
          {isFullscreen && (
            <div className="flex justify-between items-center text-white pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-black tracking-widest uppercase text-indigo-400 flex items-center gap-1.5">
                  <span>📺</span> IMMERSIVE FULL-SCREEN STUDIO PREVIEW
                </h2>
                <p className="text-[10px] text-slate-400">Photo Slideshow Studio Live Monitor • High Fidelity Canvas Renderer</p>
              </div>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-900/25 hover:scale-105 active:scale-95"
              >
                <span>❌</span> Exit Full Screen
              </button>
            </div>
          )}

          <div className={isFullscreen 
            ? "flex-1 w-full bg-slate-950 flex flex-col justify-center items-center my-4 overflow-hidden" 
            : "bg-slate-950 border border-slate-900 rounded-3xl overflow-hidden shadow-lg select-none"
          }>
            {/* Live Canvas Area */}
            <div className={isFullscreen 
              ? "flex-1 w-full max-w-5xl relative bg-slate-900 flex items-center justify-center rounded-2xl border border-slate-850 overflow-hidden shadow-2xl"
              : "aspect-video w-full relative bg-slate-900 flex items-center justify-center"
            }>
              <canvas ref={canvasRef} width={854} height={480} className="w-full h-full object-contain absolute inset-0 z-10 animate-in zoom-in-95 duration-300" />
            </div>

            {/* Controls bottom block */}
            <div className="bg-slate-900 p-4 flex flex-col gap-3">
              {/* Scrubber row */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-400 min-w-[35px]">{playTime.toFixed(1)}s</span>
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
                      drawSlideshowFrame(targetTime);
                    }
                  }}
                  className="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                />
                <span className="text-[10px] font-mono text-slate-400 min-w-[35px]">{totalDuration.toFixed(1)}s</span>
              </div>

              {/* Action Buttons row */}
              <div className="flex flex-wrap md:flex-nowrap gap-3 items-center justify-between">
                {/* Left side: basic playback */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStartPlay}
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-950 rounded-xl font-extrabold text-xs transition min-w-[75px] shrink-0 cursor-pointer flex items-center gap-1 hover:scale-105 active:scale-95"
                  >
                    {playing ? '⏸ Pause' : '▶ Preview'}
                  </button>
                  <button
                    type="button"
                    onClick={handleStopPlay}
                    className="px-3.5 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition flex items-center gap-1 active:scale-95"
                  >
                    ⏹ Stop
                  </button>
                </div>

                {/* Center: slide-level skip / speed options */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSkipBackward}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition flex items-center gap-1"
                    title="Previous Slide"
                  >
                    <span>⏮</span> <span className="hidden sm:inline">Prev Slide</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleJumpBackward}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition flex items-center gap-1"
                    title="-5 seconds"
                  >
                    <span>⏪ -5s</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleJumpForward}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition flex items-center gap-1"
                    title="+5 seconds"
                  >
                    <span>⏩ +5s</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSkipForward}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition flex items-center gap-1"
                    title="Next Slide"
                  >
                    <span>⏭</span> <span className="hidden sm:inline">Next Slide</span>
                  </button>
                </div>

                {/* Right: Fullscreen control & details */}
                <div className="flex items-center gap-3">
                  <div className="text-[10px] font-mono text-indigo-400 font-semibold italic bg-indigo-950/40 border border-indigo-900/30 px-2.5 py-1 rounded-lg max-w-[160px] truncate" title={getCurrentSlideName()}>
                    {getCurrentSlideName()}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="px-3 py-2 bg-slate-800 hover:bg-indigo-950 hover:text-indigo-400 border border-slate-700 hover:border-indigo-900/40 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                    title={isFullscreen ? "Exit Fullscreen" : "Immersive Fullscreen"}
                  >
                    {isFullscreen ? '🖥 Exit Full Screen' : '📺 Full Screen'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Background Soundtrack lists option */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-2">
              🎵 Background soundtrack
            </h4>
            <div className="space-y-1.5">
              {BUILTIN_MUSIC.slice(0, 4).map(m => (
                <div
                  key={m.id}
                  onClick={() => {
                    setMusicId(m.id);
                    onUsePrebuiltSurpriseAudioSound(m.id);
                  }}
                  className={`p-2.5 rounded-xl border transition cursor-pointer select-none flex justify-between items-center text-xs ${
                    musicId === m.id
                      ? 'border-indigo-500 bg-indigo-50/40 text-indigo-700'
                      : 'border-slate-100 bg-slate-50/50 hover:border-slate-200'
                  }`}
                >
                  <span className="font-semibold">{m.e} {m.n}</span>
                  <span className="text-[10px] font-mono text-slate-400">{m.g}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Render progress panel */}
          {rendering && (
            <div className="bg-slate-900 rounded-2xl p-5 text-white space-y-3 animate-in fade-in duration-100">
              <div className="flex justify-between items-center text-xs font-bold font-mono text-indigo-400">
                <span>Compiling moving album...</span>
                <span>{renderProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${renderProgress}%` }}></div>
              </div>
            </div>
          )}

          {/* Export error banner */}
          {!rendering && renderError && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-500 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                  !
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-extrabold text-slate-900 leading-tight">Export failed</h4>
                  <p className="text-[10px] text-slate-500 mt-1 break-words">{renderError}</p>
                </div>
              </div>
              <button
                onClick={handleCompileSlideshow}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs block text-center shadow shadow-rose-100"
              >
                🔁 Retry Export
              </button>
            </div>
          )}

          {/* Compiled outcome download banner triggers */}
          {outputUrl && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-4 animate-in zoom-in-95 duration-200">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                  ✓
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-900 leading-tight">Slideshow output rendered!</h4>
                  <p className="text-[10px] text-slate-400 mt-1">High-definition WebM file compiled with soundtrack success.</p>
                </div>
              </div>
              <a
                href={outputUrl}
                download="slideshow_campaign.webm"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs block text-center shadow shadow-emerald-100 transition"
              >
                ⬇️ Download .WebM Video
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
