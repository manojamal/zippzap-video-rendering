import React, { useState, useRef, useEffect } from 'react';
import { CP_ACCOUNTS, validateUploadFileSize, validateFileSignature, checkSubmissionRateLimit, recordSubmission } from '../utils';
import { MediaItem } from '../types';
import { submitContribution } from '../services/campaignApi';

interface ContributorPortalProps {
  onBackToHome: () => void;
  /**
   * Optional local-state callback, kept for backward compatibility with any
   * other embedding of this component. The real submission now goes straight
   * to Supabase via submitContribution() so the organizer receives it on any
   * device, live — this callback is no longer required for that to work.
   */
  onSubmitWish?: (data: {
    type: 'video' | 'audio' | 'text' | 'photo';
    from: string;
    note: string;
    textBody?: string;
    url?: string | null;
    style?: string;
  }) => void;
  celebrantName: string;
  occasion: string;
  eventId?: string;
  allWishes?: MediaItem[];
  onDeleteWish?: (id: string) => void;
}

export default function ContributorPortal({
  onBackToHome,
  onSubmitWish,
  celebrantName,
  occasion,
  eventId = 'e1',
  allWishes = [],
  onDeleteWish
}: ContributorPortalProps) {
  const [organizerMode, setOrganizerMode] = useState(false);
  const [wishFilter, setWishFilter] = useState<'all' | 'video' | 'audio' | 'text' | 'photo'>('all');
  const [wishSortField, setWishSortField] = useState<'from' | 'created' | 'type'>('created');

  // Dynamic Open Graph / Twitter Card tags for this contributor link. This is
  // the URL that actually gets pasted into a group chat before anyone opens
  // the app — without this it pastes as a bare link with no title/preview.
  useEffect(() => {
    const previousTitle = document.title;
    const ogTitle = `You're invited to surprise ${celebrantName}! 🎉`;
    const ogDescription = `Add your video, voice, photo, or written wish for ${celebrantName}'s ${occasion || 'celebration'} — takes under a minute, and it's a surprise!`;
    const ogUrl = typeof window !== 'undefined' ? window.location.href : '';

    document.title = `${ogTitle} · Zipp Zap`;

    const managedTags: HTMLMetaElement[] = [];
    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const preExisting = !!el;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      if (!preExisting) managedTags.push(el);
    };

    setMeta('property', 'og:title', ogTitle);
    setMeta('property', 'og:description', ogDescription);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', 'Zipp Zap');
    if (ogUrl) setMeta('property', 'og:url', ogUrl);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', ogTitle);
    setMeta('name', 'twitter:description', ogDescription);
    setMeta('name', 'description', ogDescription);

    return () => {
      document.title = previousTitle;
      // Only remove tags we actually created, so we don't clobber ones that
      // may have already existed for other reasons.
      managedTags.forEach(el => el.parentNode?.removeChild(el));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrantName, occasion]);


  // Filter and Sort wishes pertaining to this event campaign
  const campaignWishes = allWishes.filter(w => !eventId || w.event === eventId);
  const sortedWishes = [...campaignWishes]
    .filter(w => wishFilter === 'all' || w.type === wishFilter)
    .sort((a, b) => {
      if (wishSortField === 'from') {
        return a.from.localeCompare(b.from);
      } else if (wishSortField === 'type') {
        return a.type.localeCompare(b.type);
      } else {
        return (b.created || 0) - (a.created || 0); // Recent first
      }
    });

  // 'welcome' plays the invite's welcome video before anything else - including before the
  // login/demo-account screen, so every path into the portal (real login, quick-join guest,
  // or a demo account) sees it first, not just some of them.
  const [stage, setStage] = useState<'welcome' | 'login' | 'upload' | 'success'>('welcome');
  const [welcomeVideoEnded, setWelcomeVideoEnded] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [lockAlertMessage, setLockAlertMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('emeka@demo.ng');
  const [password, setPassword] = useState('demo1234');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('Friend');
  const [cpType, setCpType] = useState<'video' | 'audio' | 'text' | 'photo'>('video');
  
  // Custom attachment files
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [simulatedUploadStatus, setSimulatedUploadStatus] = useState<'none' | 'uploaded' | 'processing' | 'ready'>('none');

  React.useEffect(() => {
    if (selectedFile) {
      setSimulatedUploadStatus('uploaded');
      const t1 = setTimeout(() => {
        setSimulatedUploadStatus('processing');
      }, 700);
      const t2 = setTimeout(() => {
        setSimulatedUploadStatus('ready');
      }, 2000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      setSimulatedUploadStatus('none');
    }
  }, [selectedFile]);
  
  // Wish form states
  const [showSubmitConfirm, setShowSubmitConfirm] = useState<boolean>(false);
  const [wishBody, setWishBody] = useState('');
  const [wishFrom, setWishFrom] = useState('');
  const [textStyle, setTextStyle] = useState('gradient');
  const [errorWord, setError] = useState('');
  const [aiWishLoading, setAiWishLoading] = useState(false);
  const [aiWishStatus, setAiWishStatus] = useState('');
  
  // Custom interactive editing & recording states
  const [selectedFrame, setSelectedFrame] = useState('none');
  const [isPortalRecordingVoice, setIsPortalRecordingVoice] = useState(false);
  const [portalVoiceTimer, setPortalVoiceTimer] = useState(0);
  const [isPortalRecordingVideo, setIsPortalRecordingVideo] = useState(false);
  const [portalVideoTimer, setPortalVideoTimer] = useState(0);
  const [isPortalRecordingPhoto, setIsPortalRecordingPhoto] = useState(false);
  const [portalPhotoTimer, setPortalPhotoTimer] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Real media capture refs (camera/mic streams, MediaRecorder instances, live preview elements)
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const liveVideoPreviewRef = useRef<HTMLVideoElement | null>(null);

  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);

  const photoStreamRef = useRef<MediaStream | null>(null);
  const livePhotoPreviewRef = useRef<HTMLVideoElement | null>(null);

  function mapMediaError(err: any): string {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Camera/microphone access was denied. Please allow access in your browser and try again.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera or microphone was found on this device.';
    }
    if (name === 'NotReadableError') {
      return 'Your camera or microphone is already in use by another application.';
    }
    return 'Could not access your camera/microphone. Please check your device permissions.';
  }

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't let Escape silently discard an in-progress recording.
      if (isPortalRecordingVideo || isPortalRecordingVoice || isPortalRecordingPhoto) return;
      onBackToHome();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPortalRecordingVideo, isPortalRecordingVoice, isPortalRecordingPhoto, onBackToHome]);

  const startVideoRecording = async () => {
    setCaptureError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      videoStreamRef.current = stream;
      setIsPortalRecordingVideo(true);
      setPortalVideoTimer(0);
      requestAnimationFrame(() => {
        if (liveVideoPreviewRef.current) liveVideoPreviewRef.current.srcObject = stream;
      });
      const mime =
        ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ||
        'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      videoChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) videoChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(videoChunksRef.current, { type: recorder.mimeType || mime });
        const url = URL.createObjectURL(blob);
        const file = new File([blob], 'camera-selfie.webm', { type: blob.type });
        setSelectedFile(file);
        setFileUrl(url);
        setShowReviewModal(true);
        stream.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      };
      videoRecorderRef.current = recorder;
      recorder.start(250);
    } catch (err: any) {
      setCaptureError(mapMediaError(err));
      setIsPortalRecordingVideo(false);
    }
  };

  const stopVideoRecording = () => {
    setIsPortalRecordingVideo(false);
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      videoRecorderRef.current.stop();
    }
  };

  const startVoiceRecording = async () => {
    setCaptureError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      setIsPortalRecordingVoice(true);
      setPortalVoiceTimer(0);
      const mime =
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ||
        'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      voiceChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) voiceChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || mime });
        const url = URL.createObjectURL(blob);
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-greeting.${ext}`, { type: blob.type });
        setSelectedFile(file);
        setFileUrl(url);
        setShowReviewModal(true);
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
      };
      voiceRecorderRef.current = recorder;
      recorder.start(250);
    } catch (err: any) {
      setCaptureError(mapMediaError(err));
      setIsPortalRecordingVoice(false);
    }
  };

  const stopVoiceRecording = () => {
    setIsPortalRecordingVoice(false);
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      voiceRecorderRef.current.stop();
    }
  };

  const startPhotoCapture = async () => {
    setCaptureError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      photoStreamRef.current = stream;
      setIsPortalRecordingPhoto(true);
      setPortalPhotoTimer(0);
      requestAnimationFrame(() => {
        if (livePhotoPreviewRef.current) livePhotoPreviewRef.current.srcObject = stream;
      });
    } catch (err: any) {
      setCaptureError(mapMediaError(err));
      setIsPortalRecordingPhoto(false);
    }
  };

  const capturePhotoFrame = () => {
    setIsPortalRecordingPhoto(false);
    const videoEl = livePhotoPreviewRef.current;
    const stream = photoStreamRef.current;
    const finish = () => {
      stream?.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
    };
    if (videoEl && videoEl.videoWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const file = new File([blob], 'camera-shutter.jpg', { type: 'image/jpeg' });
              setSelectedFile(file);
              setFileUrl(url);
            }
            finish();
          },
          'image/jpeg',
          0.92
        );
        return;
      }
    }
    finish();
  };

  // Active Video Recording Timer Hook
  React.useEffect(() => {
    let interval: any = null;
    if (isPortalRecordingVideo) {
      interval = setInterval(() => {
        setPortalVideoTimer(prev => {
          if (prev >= 15) {
            clearInterval(interval);
            stopVideoRecording();
            return 15;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      setPortalVideoTimer(0);
    }
    return () => clearInterval(interval);
  }, [isPortalRecordingVideo]);

  // Active Voice Recording Timer Hook
  React.useEffect(() => {
    let interval: any = null;
    if (isPortalRecordingVoice) {
      interval = setInterval(() => {
        setPortalVoiceTimer(prev => {
          if (prev >= 15) {
            clearInterval(interval);
            stopVoiceRecording();
            return 15;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      setPortalVoiceTimer(0);
    }
    return () => clearInterval(interval);
  }, [isPortalRecordingVoice]);

  // Active Photo Countdown Timer Hook
  React.useEffect(() => {
    let interval: any = null;
    if (isPortalRecordingPhoto) {
      interval = setInterval(() => {
        setPortalPhotoTimer(prev => {
          if (prev >= 3) {
            clearInterval(interval);
            capturePhotoFrame();
            return 3;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      setPortalPhotoTimer(0);
    }
    return () => clearInterval(interval);
  }, [isPortalRecordingPhoto]);

  const stopAllMediaStreams = () => {
    [videoStreamRef, voiceStreamRef, photoStreamRef].forEach((ref) => {
      if (ref.current) {
        ref.current.getTracks().forEach((t) => t.stop());
        ref.current = null;
      }
    });
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      try { videoRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      try { voiceRecorderRef.current.stop(); } catch { /* ignore */ }
    }
  };

  React.useEffect(() => {
    // Ensure the camera/mic are always released when the portal unmounts.
    return () => stopAllMediaStreams();
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const account = CP_ACCOUNTS[email as keyof typeof CP_ACCOUNTS];
    if (account && account.pw === password) {
      setName(account.name);
      setWishFrom(account.name);
      setIsLoggedIn(true);
      setStage('upload');
      setCpType('video');
    } else {
      setError('Wrong password or email. Select an authorized quick login account below.');
    }
  };

  const handleQuickReg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wishFrom) {
      setError('Please type your name first or use a quick select profile!');
      return;
    }
    setName(wishFrom);
    setIsLoggedIn(false);
    setStage('upload');
    setCpType('photo'); // default guests to photo because video/audio are locked!
  };

  const selectDemoUser = (em: string) => {
    setEmail(em);
    setPassword('demo1234');
    setError('');
    
    const account = CP_ACCOUNTS[em as keyof typeof CP_ACCOUNTS];
    if (account) {
      setWishFrom(account.name);
      setName(account.name);
      setIsLoggedIn(true);
      setStage('upload');
      setCpType('video');
    }
  };

  // Process selected files and generate direct preview links
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const sizeCheck = validateUploadFileSize(file);
      if (!sizeCheck.ok) {
        alert(`⚠️ ${sizeCheck.reason}`);
        e.target.value = '';
        return;
      }
      const sigCheck = await validateFileSignature(file, cpType === 'photo' ? 'photo' : cpType === 'audio' ? 'audio' : 'video');
      if (!sigCheck.ok) {
        alert(`⚠️ ${sigCheck.reason}`);
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
      const tempUrl = URL.createObjectURL(file);
      setFileUrl(tempUrl);
    }
  };

  const handleGenerateQuickTemplate = () => {
    const templates = [
      `Happy Birthday, ${celebrantName || 'Friend'}! 🎂\n\nWishing you a spectacular year ahead filled with deep laughter, pure joy, and endless love! You inspire everyone around you every single day with your warmth and kindness.\n\nCheers to another year of beautiful memories! ✨`,
      `Cheers to this incredible milestone, ${celebrantName || 'Friend'}! 🥂\n\nMay this exciting new chapter bring you endless success, wisdom, and beautiful adventures. We are so incredibly proud of everything you have accomplished!\n\nTo the future! 🌟`,
      `Happy Birthday to an extraordinary soul! 🎈\n\nYou bring so much warmth, light, and joy into all of our lives. Thank you for simply being you. May your special day be as absolutely wonderful and bright as you are!\n\nSending big hugs! ❤️`,
      `Another year older, but definitely not wiser, ${celebrantName || 'Friend'}! 😉\n\nJust kidding — you are like a fine wine, only getting more awesome and sparkling with age! Have an absolute blast celebrating today.\n\nHappy Birthday! 🎉`,
      `Sending you my warmest thoughts and hugest smiles today, ${celebrantName || 'Friend'}! 🌻\n\nWishing you a year of happiness, robust health, and countless beautiful moments.\n\nHappy ${occasion || 'celebration'}! ✨`,
      `To my favorite partner-in-crime, ${celebrantName || 'Friend'}! 🤜🤛\n\nSo grateful for all the late-night laughs, shared secrets, and unforgettable adventures. Here's to making many more in the year ahead!\n\nHave the best celebration ever! 🥳`
    ];
    const randomIndex = Math.floor(Math.random() * templates.length);
    setWishBody(templates[randomIndex]);
  };

  const AI_WISH_STYLES: Array<'Heartfelt' | 'Milestone' | 'Playful & Fun' | 'Short & Sweet'> = [
    'Heartfelt', 'Milestone', 'Playful & Fun', 'Short & Sweet',
  ];

  const handleGenerateAiWish = async () => {
    setAiWishLoading(true);
    setAiWishStatus('Loading AI writing model...');
    try {
      const { generateContributorWish } = await import('../services/aiService');
      const style = AI_WISH_STYLES[Math.floor(Math.random() * AI_WISH_STYLES.length)];
      const text = await generateContributorWish(
        celebrantName || 'Friend',
        occasion || 'celebration',
        style,
        wishFrom || undefined,
        (pct, status) => setAiWishStatus(`${status} (${pct}%)`)
      );
      setWishBody(text);
    } catch (err) {
      alert('⚠️ AI generation failed right now — try the Quick Template button instead, or write your own!');
    } finally {
      setAiWishLoading(false);
      setAiWishStatus('');
    }
  };

  const handleWishSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cpType === 'text' && !wishBody) return;
    if (!wishFrom) return;
    if (cpType !== 'text' && !fileUrl) {
      alert(`⚠️ Please finish recording or uploading your ${cpType} before submitting.`);
      return;
    }
    const rateCheck = checkSubmissionRateLimit(eventId);
    if (!rateCheck.ok) {
      alert(`⏳ ${rateCheck.reason}`);
      return;
    }

    setShowSubmitConfirm(true);
  };

  const handleConfirmFinalSubmit = async () => {
    setShowSubmitConfirm(false);

    if (cpType !== 'text' && !fileUrl) {
      // Safety net: never silently substitute unrelated stock media for a missing
      // real recording/upload - that would submit content the contributor never made.
      alert(`⚠️ No ${cpType} was captured. Please record or upload one before submitting.`);
      return;
    }
    const rateCheck = checkSubmissionRateLimit(eventId);
    if (!rateCheck.ok) {
      alert(`⏳ ${rateCheck.reason}`);
      return;
    }

    setSubmitting(true);
    try {
      // fileUrl is a blob: URL held in this tab's memory — fetch it back into a
      // real Blob so it can be uploaded to Supabase Storage (same pattern used
      // by mediaStore.ts's persistFromObjectUrl for local IndexedDB caching).
      let fileBlob: Blob | null = null;
      if (fileUrl && cpType !== 'text') {
        const res = await fetch(fileUrl);
        fileBlob = await res.blob();
      }

      await submitContribution({
        campaignId: eventId,
        type: cpType,
        fromName: `${wishFrom} (${relation})`,
        note: cpType === 'text' ? wishBody : `Special ${cpType} submitted for ${celebrantName}'s surprise album campaign!`,
        textBody: cpType === 'text' ? wishBody : undefined,
        file: fileBlob,
      });

      recordSubmission(eventId);
      setStage('success');
    } catch (err: any) {
      alert(`⚠️ Submission failed: ${err?.message || 'Please check your connection and try again.'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Send a wish to ${celebrantName}`}
      className="fixed inset-0 bg-slate-900/98 overflow-y-auto z-[9999] flex items-start justify-center py-10 md:py-16 px-4 font-sans select-none"
    >
      <div className="fixed top-4 left-4 z-[10000]">
        <button
          onClick={onBackToHome}
          aria-label="Close and go back to home"
          className="text-xs font-bold text-slate-350 hover:text-white flex items-center gap-1.5 cursor-pointer bg-slate-950/90 border border-slate-800 px-3 py-2 rounded-xl shadow-lg transition hover:bg-slate-900"
        >
          ➔ Back to Home
        </button>
      </div>

      <div className={`w-full ${organizerMode ? 'max-w-4xl' : 'max-w-lg'} bg-slate-950 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 relative overflow-hidden shadow-2xl transition-all duration-300 my-auto`}>
        <div className="absolute top-[-30px] right-[-30px] text-8xl opacity-10 pointer-events-none select-none">🎈</div>

        <button
          onClick={onBackToHome}
          className="absolute top-4 right-4 text-slate-400 hover:text-white font-black text-xl select-none px-2.5 py-1 rounded-full hover:bg-slate-800 transition cursor-pointer"
          title="Close Portal"
        >
          ×
        </button>

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 id="contributor-portal-title" className="text-xl md:text-2xl font-black text-white">🎁 Campaign Surprise Portal</h1>
          <p className="text-xs text-indigo-400 font-bold">Secret surprise occasion contribution & organizer studio deck</p>
        </div>

        {/* Toggle between Contributor form and Organizer Submission Hub - hidden during the
            welcome video so it can't be used to skip straight past it. */}
        {stage !== 'welcome' && (
          <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800 gap-1">
            <button
              type="button"
              onClick={() => setOrganizerMode(false)}
              className={`flex-1 py-2.5 text-[11px] font-black uppercase rounded-xl transition cursor-pointer text-center ${
                !organizerMode
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ✍️ Contributor Form
            </button>
            <button
              type="button"
              onClick={() => setOrganizerMode(true)}
              className={`flex-1 py-2.5 text-[11px] font-black uppercase rounded-xl transition cursor-pointer text-center ${
                organizerMode
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              👨‍✈️ Organizer Hub ({campaignWishes.length})
            </button>
          </div>
        )}

        {/* ORGANIZER MODE: SORTING / FILTERING SUBMITTED WISHES */}
        {organizerMode ? (
          <div className="space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest pl-0.5">Submitted wishes review deck</h3>
              <p className="text-[11px] text-slate-300 mt-1">
                Currently tracking <b>{campaignWishes.length} contributions</b> for <b>{celebrantName}</b>'s surprise {occasion}. Use the tools below to organize them before executing final studio renders.
              </p>
            </div>

            {/* Sorting/Filtering Controls Container */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between border-b border-slate-800 pb-4">
              {/* Dropdown Filter by Type */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider whitespace-nowrap">Filter Type:</span>
                <select
                  value={wishFilter}
                  onChange={e => setWishFilter(e.target.value as any)}
                  className="h-9 bg-slate-900 border border-slate-800 rounded-xl px-3 text-[11px] font-bold text-white outline-none cursor-pointer hover:border-slate-700 focus:border-indigo-500"
                >
                  <option value="all">🎯 All Wishes (Show All)</option>
                  <option value="video">🎬 Videos (Preferred)</option>
                  <option value="audio">🎙️ Voice Notes</option>
                  <option value="text">✍️ Written Texts</option>
                  <option value="photo">📸 Snapshots</option>
                </select>
              </div>

              {/* Sort selector dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider whitespace-nowrap">Sort By:</span>
                <select
                  value={wishSortField}
                  onChange={e => setWishSortField(e.target.value as any)}
                  className="h-9 bg-slate-900 border border-slate-800 rounded-xl px-3 text-[11px] font-bold text-white outline-none cursor-pointer hover:border-slate-700 focus:border-indigo-500"
                >
                  <option value="created">Recent First (Date Submitted) ⏳</option>
                  <option value="from">Sender Name (A-Z) 🔠</option>
                  <option value="type">Media Group (By Type) 🎬</option>
                </select>
              </div>
            </div>

            {/* Wishes list grid */}
            {sortedWishes.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[420px] overflow-y-auto pr-1">
                {sortedWishes.map(wish => (
                  <div key={wish.id} className="bg-slate-900 border border-slate-850 rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between">
                    <div>
                      {/* Name & Badge Header */}
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <h4 className="text-xs font-black text-slate-100">{wish.from}</h4>
                          <span className="text-[9px] font-mono text-slate-400 uppercase">
                            Added {new Date(wish.created).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase ${
                          wish.type === 'video' ? 'bg-indigo-950 text-indigo-400 border border-indigo-900' :
                          wish.type === 'audio' ? 'bg-amber-950 text-amber-400 border border-amber-900' :
                          wish.type === 'photo' ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' :
                          'bg-pink-950 text-pink-400 border border-pink-900'
                        }`}>
                          {wish.type}
                        </span>
                      </div>

                      {/* Content Section / Players */}
                      <div className="mt-3">
                        {wish.type === 'text' && (
                          <div className={`p-3 rounded-xl bg-gradient-to-br ${
                            wish.style === 'royal' ? 'from-purple-900 to-indigo-950 text-white' :
                            wish.style === 'emerald' ? 'from-teal-850 to-emerald-950 text-teal-100' :
                            'from-pink-500 to-amber-500 text-white'
                          } min-h-[75px] flex items-center justify-center text-center p-3 relative`}>
                            <span className="text-[11px] font-extrabold italic leading-relaxed">
                              "{wish.textBody || wish.note}"
                            </span>
                          </div>
                        )}

                        {wish.type === 'photo' && wish.url && (
                          <div className="aspect-video rounded-xl overflow-hidden bg-slate-950 relative border border-slate-800">
                            <img src={wish.url} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}

                        {wish.type === 'video' && wish.url && (
                          <div className="aspect-video rounded-xl overflow-hidden bg-slate-950 relative border border-slate-800">
                            <video src={wish.url} controls className="w-full h-full object-contain" />
                          </div>
                        )}

                        {wish.type === 'audio' && wish.url && (
                          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 flex items-center gap-2">
                            <span className="text-sm">🎙️</span>
                            <audio src={wish.url} controls className="flex-1 h-7" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions / Delete */}
                    <div className="flex justify-between items-center pt-2.5 border-t border-slate-850 mt-2">
                      <span className="text-[9px] text-slate-500 font-mono">
                        ID: {wish.id.substring(0, 8)}
                      </span>
                      {onDeleteWish && (
                        <button
                          onClick={() => {
                            if (confirm(`Remove wish submission from ${wish.from}?`)) {
                              onDeleteWish(wish.id);
                            }
                          }}
                          className="text-[9.5px] font-black text-rose-400 hover:text-rose-300 transition cursor-pointer flex items-center gap-1"
                        >
                          🗑️ Delete Wish
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-slate-900 border border-slate-850 rounded-2xl">
                <span className="text-3xl block filter grayscale mb-2">🎈</span>
                <p className="text-xs font-bold text-slate-300">No matching wish submissions found</p>
                <p className="text-[10px] text-slate-500 mt-1">Change your filtering pills or invite teammates to start receiving materials!</p>
              </div>
            )}

            <div className="pt-3 border-t border-slate-900 text-center">
              <button
                onClick={onBackToHome}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-xs font-bold text-indigo-400 cursor-pointer"
              >
                ➔ Close Portal
              </button>
            </div>
          </div>
        ) : (
          /* STANDARD CONTRIBUTOR FLOW STAGES */
          <>
            {/* STAGE 0: WELCOME VIDEO - plays before login/demo-account entry, for every
                contributor who opens the invite link. */}
            {stage === 'welcome' && (
              <div className="space-y-4 animate-in zoom-in-95 duration-150">
                <div className="text-center space-y-1.5">
                  <div className="text-4xl">🎉</div>
                  <h3 className="text-sm font-extrabold text-white">
                    You're invited to surprise {celebrantName}!
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Watch this quick welcome message, then add your video, voice, photo, or written wish.
                  </p>
                </div>

                <div className="aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 relative">
                  <video
                    src="/media/welcome-message.mp4"
                    controls
                    playsInline
                    data-testid="cp-welcome-video"
                    className="w-full h-full object-contain bg-black"
                    onEnded={() => setWelcomeVideoEnded(true)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setStage('login')}
                  data-testid="cp-welcome-continue"
                  className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition cursor-pointer shadow-lg active:scale-95 flex items-center justify-center gap-2"
                >
                  {welcomeVideoEnded ? '✓ Continue to Login' : 'Continue to Login →'}
                </button>
              </div>
            )}

            {/* STAGE 1: SIGN IN / QUICK REG */}
            {stage === 'login' && (
              <div className="space-y-4 animate-in zoom-in-95 duration-150">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center space-y-4">
                  <div className="text-4xl">🔐</div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white">Verification & Quick Entrance</h3>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Log in as an invited contributor to unlock premium live video/voice recording, text greetings, and customized photos.
                    </p>
                  </div>

                  {/* Direct Quick Join Box */}
                  <form onSubmit={handleQuickReg} className="space-y-3 max-w-sm mx-auto border-b border-slate-800 pb-4">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-wider text-left pl-1">
                      ⚠️ Join Instantly as Guest (Photos Only):
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        placeholder="Type Your Name (e.g. Aunt Fatima)"
                        className="flex-1 h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-xs text-white outline-none focus:border-indigo-500"
                        value={wishFrom}
                        onChange={e => {
                          setWishFrom(e.target.value);
                          setError('');
                        }}
                      />
                      <button
                        type="submit"
                        className="h-11 px-4 bg-amber-650 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                      >
                        Join Guest ➔
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-500 text-left pl-1 leading-normal">
                      *Guest access is restricted to photo template designs. Log in/verify below to record voice, video, or write text!
                    </p>
                  </form>

                  {/* Verified Sign-in Form */}
                  <form onSubmit={handleLogin} className="space-y-3 max-w-sm mx-auto pt-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider text-left pl-1">Or Log in with Invite Email:</p>
                    <input
                      type="email"
                      required
                      placeholder="your@email.com"
                      className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-xs text-white outline-none focus:border-indigo-500"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />
                    <input
                      type="password"
                      required
                      placeholder="Password"
                      className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-xs text-white outline-none focus:border-indigo-500"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                    
                    {errorWord && <div className="text-[10px] text-rose-500 font-bold font-mono">{errorWord}</div>}

                    <button
                      type="submit"
                      className="w-full h-11 border border-slate-800 hover:bg-slate-950 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                    >
                      Verify Authorized Partner Login
                    </button>
                  </form>

                  {/* Click Profile Shortcuts */}
                  <div className="border-t border-slate-850 pt-4 space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Invited Relations Shortcuts</p>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {Object.keys(CP_ACCOUNTS).map(em => {
                        const nameShort = CP_ACCOUNTS[em as keyof typeof CP_ACCOUNTS].name;
                        return (
                          <button
                            key={em}
                            onClick={() => selectDemoUser(em)}
                            className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold transition hover:bg-slate-800 ${
                              email === em
                                ? 'border-indigo-500 bg-indigo-950/20 text-indigo-400'
                                : 'border-slate-800 bg-slate-950 text-slate-400'
                            }`}
                          >
                            {nameShort}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Unique Share invite link generator */}
                  <div className="border-t border-slate-850 pt-4 space-y-2 text-left">
                    <p className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-wider pl-1 font-mono">
                      🔗 Unique Share Invite Link (Event: {eventId})
                    </p>
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-300 font-mono truncate select-all flex-1 pr-1">
                        https://zippzap.ng/portal/{eventId}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(`https://zippzap.ng/portal/${eventId}`);
                          alert(`🔗 Surprise link copied for event ${eventId}! Share with your teammate networks!`);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-extrabold shrink-0 cursor-pointer transition text-center"
                      >
                        Copy Link
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 italic pl-1 leading-normal">
                      Contributors can use this custom link to join and submit secret videos or lovely audio greetings directly.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 2: CUSTOMIZE AND ATTACH WISH */}
            {stage === 'upload' && (
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* Invite guidelines card */}
                <div className="bg-indigo-950/50 border border-indigo-900 rounded-2xl p-4 text-xs text-indigo-200">
                  <span className="font-extrabold text-indigo-400 block mb-1">📨 PROMPT FROM CAMPAIGN MANAGER</span>
                  Hi {name}! 👋 I am organizing a surprise {occasion} video album for {celebrantName}!
                  Please record or write your special wish below. We stitch everything automatically!
                </div>

                {/* Relations dropdown selector */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Your relation to celebrant</label>
                  <select
                    className="w-full h-10 bg-slate-900 border border-slate-800 rounded-xl px-4 text-xs text-white outline-none focus:border-indigo-500"
                    value={relation}
                    onChange={e => setRelation(e.target.value)}
                  >
                    <option value="Friend">Friend</option>
                    <option value="Best Friend">Best Friend</option>
                    <option value="Family">Family Member</option>
                    <option value="Mom">Mother</option>
                    <option value="Dad">Father</option>
                    <option value="Brother">Brother</option>
                    <option value="Sister">Sister</option>
                    <option value="Colleague">Work Teammate</option>
                    <option value="Partner">Spouse / Partner</option>
                  </select>
                </div>

                 {/* Select wish content option */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Choose your wish option type</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['video', 'audio', 'text', 'photo'] as const).map(type => {
                      const isActive = cpType === type;
                      const isLocked = !isLoggedIn && (type === 'video' || type === 'audio' || type === 'text');
                      const emoji = isLocked ? '🔒' : type === 'video' ? '🎬' : type === 'audio' ? '🎙️' : type === 'text' ? '✍️' : '📸';
                      return (
                        <div
                          key={type}
                          onClick={() => {
                            if (isLocked) {
                              setLockAlertMessage(`🔒 Video, Audio, and Text greeting designs are reserved for authenticated invite partners. Please authenticate or select an invited relations shortcut to unlock high-fidelity voice & video recording! Guest accounts are fully enabled for customized photo templates.`);
                              return;
                            }
                            setLockAlertMessage(null);
                            setCpType(type);
                            setSelectedFile(null);
                            setFileUrl(null);
                            stopAllMediaStreams();
                            setIsPortalRecordingVideo(false);
                            setIsPortalRecordingVoice(false);
                            setIsPortalRecordingPhoto(false);
                          }}
                          className={`py-3 px-2 rounded-xl border text-center transition cursor-pointer select-none font-sans relative ${
                            isActive
                              ? 'border-indigo-500 bg-indigo-950/40 text-indigo-400 font-bold'
                              : isLocked
                                ? 'border-slate-900 bg-slate-950/30 text-slate-600 opacity-60'
                                : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          {type === 'video' && !isLocked && (
                            <span className="absolute top-[-5px] right-[-5px] bg-indigo-650 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase scale-90 animate-pulse">
                              Best
                            </span>
                          )}
                          <div className="text-xl mb-1">{emoji}</div>
                          <div className="text-[10px] truncate capitalize">{type}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Media format policy notice */}
                <div className="bg-slate-950/80 border border-slate-850 rounded-2xl p-3.5 space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400 block">⚡ Media Formats Policy</span>
                  {cpType === 'video' && (
                    <p className="text-[10px] text-slate-400 leading-normal">
                      🎥 <b>Video:</b> Local device file uploads are disabled to preserve raw authentic sentiments. Please use our <b>Live Selfie Recorder</b> below to record a warm video wish!
                    </p>
                  )}
                  {cpType === 'audio' && (
                    <p className="text-[10px] text-slate-400 leading-normal">
                      🎙️ <b>Voice:</b> Local audio file uploads are disabled to guarantee consistent studio sound. Please use our <b>Live Microphone Recorder</b> to record your greeting!
                    </p>
                  )}
                  {cpType === 'photo' && (
                    <p className="text-[10px] text-slate-400 leading-normal">
                      📸 <b>Photo:</b> Snap a live camera snapshot OR upload any image from your device, then dress it up with our beautiful templates & design frames completely free!
                    </p>
                  )}
                  {cpType === 'text' && (
                    <p className="text-[10px] text-slate-400 leading-normal">
                      ✍️ <b>Text:</b> Type your wish, and choose from modern layout styles. We will render it into a gorgeous cinematic text slide!
                    </p>
                  )}
                </div>

                {(cpType === 'video' || cpType === 'audio') && (
                  <div className="flex items-start gap-2 bg-emerald-950/25 border border-emerald-900/40 rounded-2xl p-3">
                    <span className="text-sm leading-none mt-0.5" aria-hidden="true">🔒</span>
                    <p className="text-[10px] text-emerald-300/90 leading-relaxed">
                      Your {cpType === 'video' ? 'recording' : 'audio'} stays in this browser and is only shared with{' '}
                      <b>{celebrantName}</b>'s event organizer — it isn't uploaded anywhere else.
                    </p>
                  </div>
                )}

                {lockAlertMessage && (
                  <div className="bg-rose-950/30 border border-rose-900/50 rounded-2xl p-4 text-xs text-rose-350 space-y-3 animate-in fade-in duration-200">
                    <p className="leading-relaxed">{lockAlertMessage}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setStage('login');
                        setLockAlertMessage(null);
                      }}
                      className="px-3.5 py-1.5 bg-rose-900/65 hover:bg-rose-800 border border-rose-850 rounded-lg text-[10px] font-bold text-white transition cursor-pointer"
                    >
                      🔑 Switch to Verification / Partner Shortcuts ➔
                    </button>
                  </div>
                )}

                {/* Inputs & Video overlays */}
                <form onSubmit={handleWishSubmit} className="space-y-4">
                  {cpType !== 'text' ? (
                    <div className="space-y-4">
                      
                      {/* Integrated Recording HUD & Preview confirmation module depending on media type */}
                      {cpType === 'video' && (
                        <div>
                          {!fileUrl && !isPortalRecordingVideo && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center space-y-4">
                              <div className="text-4xl animate-bounce duration-1000">🎥</div>
                              <div>
                                <h4 className="text-xs font-black tracking-widest text-indigo-400 uppercase">Selfie Video Wish Recorder</h4>
                                <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                                  Record a high-fidelity video wishing <b>{celebrantName}</b> directly from your camera! (Most Preferred Choice 🌟)
                                </p>
                              </div>
                              {captureError && (
                                <p className="text-rose-400 text-[10px] font-semibold leading-relaxed">{captureError}</p>
                              )}
                              <button
                                type="button"
                                onClick={startVideoRecording}
                                className="w-full h-11 bg-indigo-650 hover:bg-indigo-600 text-white font-black text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                              >
                                🔴 {captureError ? 'Try Again' : 'Tap to Start Live Recording'}
                              </button>
                            </div>
                          )}

                          {isPortalRecordingVideo && (
                            <div className="bg-slate-900 border border-red-950 rounded-2xl p-5 text-center space-y-4">
                              <div className="aspect-video w-full rounded-xl bg-slate-950 overflow-hidden border border-red-900 relative">
                                <video ref={liveVideoPreviewRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                                <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded-full">
                                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                  <span className="text-[9px] font-bold text-white">REC</span>
                                </div>
                              </div>
                              <div>
                                <h4 className="text-xs font-black tracking-widest text-red-500 uppercase">Live Selfie Video Recording</h4>
                                <p className="text-xs font-mono font-extrabold text-red-400 mt-1">RECORDING TIMELINE: {portalVideoTimer}s / 15s</p>
                                <p className="text-[10px] text-slate-400 mt-2">Smile, look at the camera, and speak your heartfelt wishes clearly!</p>
                              </div>
                              <button
                                type="button"
                                onClick={stopVideoRecording}
                                className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
                              >
                                ⏹️ Stop & Render Clip
                              </button>
                            </div>
                          )}

                          {fileUrl && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">👀 Video Preview Player</span>
                                <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded-full font-bold">✓ Clip Compiled</span>
                              </div>
                              <div className="aspect-video w-full rounded-xl bg-slate-950 overflow-hidden border border-slate-850">
                                <video src={fileUrl} controls className="w-full h-full object-contain" />
                              </div>
                              
                              <div className="bg-slate-950 border border-slate-850 p-3.5 rounded-xl space-y-2">
                                <div className="flex items-center justify-between text-[10px] font-bold text-emerald-400">
                                  <span>🪄 Studio Engine Applied:</span>
                                  <span>✓ Ready to send</span>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-normal">
                                  Face auto-focused. Environmental noise cancelled (-14dB). Speech levels normalized for high-fidelity TV playback.
                                </p>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (fileUrl) URL.revokeObjectURL(fileUrl);
                                    setSelectedFile(null);
                                    setFileUrl(null);
                                    setIsPortalRecordingVideo(false);
                                  }}
                                  className="h-10 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-350 font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                  🔄 Redo Recording
                                </button>
                                <div className="h-10 bg-emerald-650/15 border border-emerald-900 text-emerald-400 font-bold text-xs rounded-xl flex items-center justify-center gap-1">
                                  ✓ Clip Confirmed
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {cpType === 'audio' && (
                        <div>
                          {!fileUrl && !isPortalRecordingVoice && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center space-y-4">
                              <div className="text-4xl animate-bounce duration-1000">🎙️</div>
                              <div>
                                <h4 className="text-xs font-black tracking-widest text-indigo-400 uppercase">Vocal Greeting Recorder</h4>
                                <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                                  Record a clear voice message wishing <b>{celebrantName}</b> directly from your microphone!
                                </p>
                              </div>
                              {captureError && (
                                <p className="text-rose-400 text-[10px] font-semibold leading-relaxed">{captureError}</p>
                              )}
                              <button
                                type="button"
                                onClick={startVoiceRecording}
                                className="w-full h-11 bg-indigo-650 hover:bg-indigo-600 text-white font-black text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                              >
                                🔴 {captureError ? 'Try Again' : 'Tap to Start Voice Recording'}
                              </button>
                            </div>
                          )}

                          {isPortalRecordingVoice && (
                            <div className="bg-slate-900 border border-red-950 rounded-2xl p-5 text-center space-y-4">
                              <div className="relative inline-flex items-center justify-center">
                                <span className="absolute inline-flex h-10 w-10 rounded-full bg-rose-650 opacity-30 animate-ping" />
                                <div className="w-5 h-5 rounded-full bg-rose-600 flex items-center justify-center text-[10px] text-white">●</div>
                              </div>
                              <div>
                                <h4 className="text-xs font-black tracking-widest text-rose-500 uppercase">Live Vocal Recording</h4>
                                <div className="my-3 bg-red-950/50 border border-red-900 p-3.5 rounded-2xl max-w-xs mx-auto text-center space-y-1">
                                  <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest block">⏱️ Recording Countdown</span>
                                  <span className="text-3xl font-black font-mono text-white tracking-widest block">{15 - portalVoiceTimer}s Remaining</span>
                                </div>
                                <p className="text-[10px] text-slate-400">Speak directly into your device microphone. We filter background hums instantly.</p>
                              </div>
                              <button
                                type="button"
                                onClick={stopVoiceRecording}
                                className="w-full h-11 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
                              >
                                ⏹️ Stop & Save Voice
                              </button>
                            </div>
                          )}

                          {fileUrl && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">👀 Voice Clip Preview</span>
                                <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded-full font-bold">✓ Audio Compiled</span>
                              </div>
                              <div className="p-4 bg-slate-950 rounded-xl flex items-center gap-3 border border-slate-850">
                                <span className="text-2xl animate-pulse">🎙️</span>
                                <audio src={fileUrl} controls className="flex-1 h-8 outline-none" />
                              </div>

                              {/* Waveform dynamic decoration */}
                              <div className="flex justify-center items-center gap-1 py-1 px-4">
                                <div className="h-4 w-1 bg-indigo-500 rounded animate-bounce duration-500" />
                                <div className="h-8 w-1 bg-indigo-400 rounded animate-bounce duration-700 delay-100" />
                                <div className="h-6 w-1 bg-indigo-600 rounded animate-bounce duration-300 delay-200" />
                                <div className="h-10 w-1 bg-indigo-400 rounded animate-bounce duration-500 delay-300" />
                                <div className="h-5 w-1 bg-indigo-500 rounded animate-bounce duration-600 delay-150" />
                                <div className="h-8 w-1 bg-indigo-600 rounded animate-bounce duration-400 delay-75" />
                                <div className="h-4 w-1 bg-indigo-400 rounded animate-bounce duration-500 delay-250" />
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (fileUrl) URL.revokeObjectURL(fileUrl);
                                    setSelectedFile(null);
                                    setFileUrl(null);
                                    setIsPortalRecordingVoice(false);
                                  }}
                                  className="h-10 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-350 font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                  🔄 Redo Recording
                                </button>
                                <div className="h-10 bg-emerald-650/15 border border-emerald-900 text-emerald-400 font-bold text-xs rounded-xl flex items-center justify-center gap-1">
                                  ✓ Voice Confirmed
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {cpType === 'photo' && (
                        <div>
                          {!fileUrl && !isPortalRecordingPhoto && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center space-y-4">
                              <div className="text-4xl animate-bounce duration-1000">📸</div>
                              <div>
                                <h4 className="text-xs font-black tracking-widest text-indigo-400 uppercase">Selfie Photo Wish Designer</h4>
                                <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                                  Snap a live camera selfie photo OR upload a custom picture to apply amazing free visual frame templates!
                                </p>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                  type="button"
                                  onClick={startPhotoCapture}
                                  className="flex-1 h-11 bg-indigo-650 hover:bg-indigo-600 text-white font-black text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                                >
                                  📷 Tap to Snap Photo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => fileInputRef.current?.click()}
                                  className="flex-1 h-11 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-black text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                                >
                                  📤 Upload Local Photo
                                </button>
                              </div>
                              {captureError && (
                                <p className="text-rose-400 text-[10px] font-semibold leading-relaxed">{captureError}</p>
                              )}
                              <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleFileChange}
                              />
                            </div>
                          )}

                          {isPortalRecordingPhoto && (
                            <div className="bg-slate-900 border border-amber-950 rounded-2xl p-5 text-center space-y-4">
                              <div className="aspect-video w-full rounded-xl bg-slate-950 overflow-hidden border border-amber-900">
                                <video ref={livePhotoPreviewRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                              </div>
                              <div>
                                <h4 className="text-xs font-black tracking-widest text-amber-500 uppercase">Cheese! Shutter Countdown</h4>
                                <p className="text-xs font-mono font-extrabold text-amber-400 mt-1">SNAP IN: {3 - portalPhotoTimer}s</p>
                                <p className="text-[10px] text-slate-400 mt-2">Get ready and smile big for the surprise photobook frame!</p>
                              </div>
                              <button
                                type="button"
                                onClick={capturePhotoFrame}
                                className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
                              >
                                ⚡ Shutter Shutter Now
                              </button>
                            </div>
                          )}

                          {fileUrl && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">🖼️ Frame Decorator Options</span>
                                <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded-full font-bold">✓ Photo Snapped</span>
                              </div>
                              
                              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                                {[
                                  { id: 'none', label: 'None 🚫' },
                                  { id: 'classic-polaroid', label: 'Polaroid 📸' },
                                  { id: 'elegant-gold', label: 'VIP Gold 👑' },
                                  { id: 'vintage-filmstrip', label: 'Filmstrip 🎞️' },
                                  { id: 'gilded-vip', label: 'Royal Gold 💎' },
                                  { id: 'neon-aura', label: 'Neon Glow ⚡' },
                                  { id: 'floral-garden', label: 'Floral 🌸' },
                                  { id: 'birthday-bash', label: 'Birthday 🎈' },
                                  { id: 'retro-vintage', label: 'VHS Retro 📼' },
                                  { id: 'modern-minimal', label: 'Gallery 🪵' }
                                ].map(frm => {
                                  const isActive = selectedFrame === frm.id;
                                  return (
                                    <button
                                      type="button"
                                      key={frm.id}
                                      onClick={() => {
                                        setSelectedFrame(frm.id);
                                        setTextStyle(frm.id); // Save to database payload
                                      }}
                                      className={`py-2 px-1 rounded-xl text-[9px] font-black border text-center transition cursor-pointer select-none ${
                                        isActive
                                          ? 'border-indigo-500 bg-indigo-950 text-indigo-300 font-black'
                                          : 'border-slate-850 bg-slate-950 text-slate-450 hover:border-slate-700'
                                      }`}
                                    >
                                      {frm.label}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Decorated Memory Preview Box */}
                              <div className="w-full rounded-xl bg-slate-950 p-4 flex items-center justify-center overflow-hidden border border-slate-850">
                                <div className={`relative max-w-sm rounded bg-white transition-all overflow-hidden flex flex-col items-center p-2.5 pb-8 ${
                                  selectedFrame === 'classic-polaroid' ? 'border-b-[45px] border-t-8 border-x-8 border-white shadow-2xl text-slate-900 font-serif' :
                                  selectedFrame === 'elegant-gold' ? 'border-8 border-amber-400 ring-8 ring-amber-300 shadow-xl' :
                                  selectedFrame === 'vintage-filmstrip' ? 'border-y-[20px] border-x-[10px] border-dashed border-zinc-950 shadow-md text-white' :
                                  selectedFrame === 'gilded-vip' ? 'border-8 border-indigo-900 ring-4 ring-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.5)] bg-slate-900 text-indigo-200' :
                                  selectedFrame === 'neon-aura' ? 'border-4 border-slate-900 shadow-[0_0_20px_#f43f5e,0_0_20px_#3b82f6] bg-black text-pink-400' :
                                  selectedFrame === 'floral-garden' ? 'border-8 border-pink-100 ring-4 ring-pink-300 shadow-lg bg-pink-50' :
                                  selectedFrame === 'birthday-bash' ? 'border-8 border-amber-300 ring-4 ring-amber-450 shadow-xl bg-amber-50' :
                                  selectedFrame === 'retro-vintage' ? 'border-4 border-zinc-800 sepia contrast-125 shadow-md bg-zinc-900 text-amber-500 font-mono' :
                                  selectedFrame === 'modern-minimal' ? 'border-[12px] border-amber-900/20 shadow-2xl bg-stone-100 text-stone-800' :
                                  'border border-slate-800 rounded-lg bg-slate-900'
                                }`}>
                                  <img src={fileUrl} className={`max-h-[160px] object-contain rounded ${
                                    selectedFrame === 'retro-vintage' ? 'sepia hue-rotate-15' : ''
                                  }`} alt="Captured Memory" />
                                  {selectedFrame === 'classic-polaroid' && (
                                    <div className="absolute bottom-[-32px] text-center font-bold text-slate-800 text-[10.5px]">
                                      {wishFrom || 'Best Friends'} — {occasion} 🥂
                                    </div>
                                  )}
                                  {selectedFrame === 'gilded-vip' && (
                                    <div className="absolute bottom-1 right-2 text-[8px] font-mono tracking-widest text-indigo-300 uppercase">
                                      💎 PREMIUM VIP TRIBUTE
                                    </div>
                                  )}
                                  {selectedFrame === 'neon-aura' && (
                                    <div className="absolute top-1 left-2 text-[8px] font-black tracking-widest text-pink-500 animate-pulse">
                                      ⚡ NEON GLOW PARTY
                                    </div>
                                  )}
                                  {selectedFrame === 'floral-garden' && (
                                    <div className="absolute bottom-1 text-[9px] font-semibold text-pink-700 flex items-center gap-1">
                                      🌸 Love & Happiness 🌺
                                    </div>
                                  )}
                                  {selectedFrame === 'birthday-bash' && (
                                    <div className="absolute top-1 right-2 text-xs">
                                      🎈🎁🎉
                                    </div>
                                  )}
                                  {selectedFrame === 'retro-vintage' && (
                                    <div className="absolute bottom-1 left-2 text-[8px] text-emerald-400 font-mono">
                                      PLAY ▶ 0:00 [JULY 2026]
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (fileUrl) URL.revokeObjectURL(fileUrl);
                                    setSelectedFile(null);
                                    setFileUrl(null);
                                    setIsPortalRecordingPhoto(false);
                                  }}
                                  className="h-10 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-350 font-black text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                  🔄 Retake Snapshot
                                </button>
                                <div className="h-10 bg-emerald-650/15 border border-emerald-900 text-emerald-400 font-bold text-xs rounded-xl flex items-center justify-center gap-1">
                                  ✓ Frame Confirmed
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Your surprise written greeting *
                          </label>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={handleGenerateQuickTemplate}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-indigo-600 to-purple-650 hover:from-indigo-500 hover:to-purple-550 text-white font-extrabold text-[10px] rounded-full shadow-md transition-all cursor-pointer hover:shadow-indigo-500/20 active:scale-95"
                            >
                              🪄 Quick Template (Auto-Fill)
                            </button>
                            <button
                              type="button"
                              disabled={aiWishLoading}
                              onClick={handleGenerateAiWish}
                              title="Generates a fresh message personalized to the celebrant and occasion, on-device"
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-white font-extrabold text-[10px] rounded-full shadow-md transition-all cursor-pointer hover:shadow-rose-500/20 active:scale-95 disabled:opacity-60"
                            >
                              {aiWishLoading ? '⏳ Generating...' : '✨ AI Personalized'}
                            </button>
                          </div>
                        </div>
                        {aiWishStatus && (
                          <p className="text-[9px] text-indigo-400 mb-1.5">{aiWishStatus}</p>
                        )}

                        {/* Quick Templates Buttons Row */}
                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                          {[
                            {
                              label: "🎂 Heartfelt",
                              text: "Wishing you a spectacular year ahead filled with deep laughter, pure joy, and endless love! You inspire everyone around you every single day. Happy Birthday!"
                            },
                            {
                              label: "🥂 Milestone",
                              text: "Cheers to this truly incredible milestone! May this exciting new chapter bring you endless success, wisdom, and beautiful adventures. So incredibly proud of you!"
                            },
                            {
                              label: "🎈 Playful & Fun",
                              text: "Another year older, but definitely not wiser! 😉 Just kidding — you are like a fine wine, only getting more awesome and sparkling with age. Have an absolute blast!"
                            },
                            {
                              label: "🌟 Inspiration",
                              text: "To an extraordinary soul who brings so much warmth, kindness, and light into our lives. Thank you for simply being you. May your special day be as wonderful as you are!"
                            },
                            {
                              label: "✨ Short & Sweet",
                              text: "Sending you my warmest thoughts and hugest smiles on your big day! Wishing you a year of happiness, health, and beautiful moments. Cheers!"
                            }
                          ].map((tpl, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setWishBody(tpl.text);
                              }}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-900/60 hover:text-indigo-200 border border-slate-750 hover:border-indigo-700 rounded-lg text-[10px] text-slate-350 font-bold transition-all cursor-pointer active:scale-95"
                              title="Click to load pre-formatted wish text"
                            >
                              {tpl.label}
                            </button>
                          ))}
                        </div>

                        <textarea
                          required
                          rows={4}
                          placeholder="Type your joyful surprise wish details here..."
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-indigo-500"
                          value={wishBody}
                          onChange={e => setWishBody(e.target.value)}
                        />
                      </div>

                      {/* Design style presets selector for Text greeting slide */}
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select slide visual design backdrop</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: 'gradient', label: 'Sunset Sunset 🌅', style: 'from-pink-500 to-amber-500' },
                            { id: 'royal', label: 'Royal Gold 👑', style: 'from-purple-900 to-indigo-950' },
                            { id: 'emerald', label: 'Emerald Forest 🌲', style: 'from-teal-850 to-emerald-950' }
                          ].map(theme => (
                            <div
                              key={theme.id}
                              onClick={() => setTextStyle(theme.id)}
                              className={`p-2 rounded-lg border text-center transition cursor-pointer select-none ${
                                textStyle === theme.id ? 'border-white text-white font-bold' : 'border-slate-850 text-slate-450 hover:border-slate-700'
                              }`}
                            >
                              <div className={`h-3 w-full rounded bg-gradient-to-r ${theme.style} mb-1`} />
                              <span className="text-[9.5px] whitespace-nowrap">{theme.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Real-time live card preview for text wish */}
                      {wishBody && (
                        <div className="bg-slate-900 border border-slate-850 p-3.5 rounded-xl space-y-2">
                          <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block">👀 Text Greeting Card Preview</span>
                          <div className={`p-5 rounded-xl bg-gradient-to-br ${
                            textStyle === 'royal' ? 'from-purple-900 to-indigo-950 text-white font-serif' :
                            textStyle === 'emerald' ? 'from-teal-850 to-emerald-950 text-teal-100 font-sans' :
                            'from-pink-500 to-amber-500 text-white font-sans'
                          } min-h-[90px] flex flex-col items-center justify-center text-center relative shadow-lg`}>
                            <span className="text-[11px] font-bold leading-relaxed block italic max-w-xs">
                              "{wishBody}"
                            </span>
                            <span className="text-[9px] font-mono opacity-80 mt-2 block tracking-wider uppercase">
                              — {wishFrom || 'Your Name'} ({relation})
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sender Name Signature */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">From (Your Signature Name) *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Grandma Helen"
                        className="w-full h-11 bg-slate-900 border border-slate-800 rounded-xl px-4 text-xs text-white outline-none focus:border-indigo-500"
                        value={wishFrom}
                        onChange={e => setWishFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Campaign reference occasion</label>
                      <input
                        type="text"
                        disabled
                        className="w-full h-11 bg-slate-900/50 border border-slate-850 rounded-xl px-4 text-xs text-slate-500 cursor-not-allowed outline-none font-medium"
                        value={`${occasion} for ${celebrantName}`}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={cpType !== 'text' && !fileUrl}
                    className={`w-full h-11 font-black text-xs rounded-xl shadow-lg transition mt-4 cursor-pointer flex items-center justify-center gap-2 ${
                      (cpType !== 'text' && !fileUrl)
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-850'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {cpType !== 'text' && !fileUrl
                      ? '👆 Record and confirm your wish above first!'
                      : 'Submit My surprise wish 🎊'}
                  </button>
                </form>
              </div>
            )}

            {/* STAGE 3: SUCCESS BLOCK */}
            {stage === 'success' && (
              <div className="text-center py-8 space-y-6 animate-in zoom-in-95 duration-200">
                <div className="text-6xl animate-bounce">🎊</div>
                <div className="space-y-2">
                  <h2 className="text-lg font-black text-white">Wish Received Successfully!</h2>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto leading-normal">
                    Thank you so much, {wishFrom}! Your {cpType} wish contribution has been integrated into the centralized surprise campaign. {celebrantName} is going to be incredibly amazed! 🤫
                  </p>
                </div>
                
                <button
                  onClick={onBackToHome}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-xs font-bold text-indigo-400 cursor-pointer transition"
                >
                  ➔ Return back to main system
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Dynamic Review, Edit & Confirm Modal */}
      {showReviewModal && fileUrl && (
        <div className="fixed inset-0 z-[11000] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="absolute top-[-20px] right-[-20px] text-7xl opacity-5 pointer-events-none select-none">🪄</div>
            
            <div className="space-y-1">
              <h3 className="text-sm font-black uppercase tracking-widest text-indigo-400">🪄 Review & Polish Wish</h3>
              <p className="text-xs text-slate-400">Review your recording, customize your sender signature, and confirm before sending!</p>
            </div>

            {/* Media Preview Box */}
            <div className="bg-slate-950 rounded-2xl p-4 border border-slate-850 flex flex-col items-center justify-center min-h-[140px]">
              {cpType === 'video' && (
                <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 relative">
                  <video src={fileUrl} controls className="w-full h-full object-contain" autoPlay loop muted />
                  <span className="absolute bottom-2 right-2 bg-indigo-650/80 backdrop-blur text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase font-sans">
                    🎥 Studio Preview
                  </span>
                </div>
              )}

              {cpType === 'audio' && (
                <div className="w-full space-y-3.5 text-center">
                  <div className="text-4xl animate-pulse">🎙️</div>
                  <div className="flex justify-center">
                    <audio src={fileUrl} controls className="w-full max-w-xs scale-90" autoPlay />
                  </div>
                  <span className="text-[10px] text-slate-505 font-semibold block font-sans">
                    ✓ Voice processed with studio-grade noise-reduction
                  </span>
                </div>
              )}

              {cpType === 'photo' && (
                <div className={`relative max-w-xs rounded bg-white p-2 pb-6 text-slate-900 shadow-xl overflow-hidden flex flex-col items-center ${
                  selectedFrame === 'classic-polaroid' ? 'border-b-[40px] border-t-8 border-x-8 border-white text-slate-900 font-serif' :
                  selectedFrame === 'elegant-gold' ? 'border-4 border-amber-400 ring-4 ring-amber-300 shadow-md' :
                  selectedFrame === 'vintage-filmstrip' ? 'border-y-[15px] border-x-[8px] border-dashed border-zinc-950 text-white' :
                  selectedFrame === 'gilded-vip' ? 'border-6 border-indigo-900 ring-2 ring-indigo-400 bg-slate-900 text-indigo-200 font-sans' :
                  selectedFrame === 'neon-aura' ? 'border-2 border-slate-900 shadow-[0_0_15px_#f43f5e] bg-black text-pink-400 font-sans' :
                  selectedFrame === 'floral-garden' ? 'border-6 border-pink-100 ring-2 ring-pink-300 bg-pink-50 font-sans' :
                  selectedFrame === 'birthday-bash' ? 'border-6 border-amber-300 ring-2 ring-amber-450 bg-amber-50 font-sans' :
                  selectedFrame === 'retro-vintage' ? 'border-2 border-zinc-800 sepia contrast-125 bg-zinc-900 text-amber-500 font-mono' :
                  selectedFrame === 'modern-minimal' ? 'border-[8px] border-amber-900/20 bg-stone-100 text-stone-800 font-sans' :
                  'border border-slate-800 rounded'
                }`}>
                  <img src={fileUrl} className="max-h-[120px] object-contain rounded" alt="Polaroid Memory" />
                  {selectedFrame === 'classic-polaroid' && (
                    <div className="absolute bottom-[-24px] text-center font-bold text-slate-800 text-[9px]">
                      {wishFrom || 'Best Friends'} — {occasion} 🥂
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Editable Settings form */}
            <div className="space-y-3.5 bg-slate-950 p-4 rounded-2xl border border-slate-850">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">✍️ Edit Signature Name</label>
                <input
                  type="text"
                  required
                  placeholder="Your Name (e.g. Uncle Jack)"
                  className="w-full h-10 bg-slate-900 border border-slate-800 rounded-xl px-3 text-xs text-white outline-none focus:border-indigo-500 font-bold"
                  value={wishFrom}
                  onChange={e => setWishFrom(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">🤝 Relationship Relation</label>
                <select
                  className="w-full h-10 bg-slate-900 border border-slate-800 rounded-xl px-3 text-xs text-white outline-none focus:border-indigo-500 font-medium"
                  value={relation}
                  onChange={e => setRelation(e.target.value)}
                >
                  <option value="Friend">Friend</option>
                  <option value="Best Friend">Best Friend</option>
                  <option value="Family">Family Member</option>
                  <option value="Mom">Mother</option>
                  <option value="Dad">Father</option>
                  <option value="Brother">Brother</option>
                  <option value="Sister">Sister</option>
                  <option value="Colleague">Work Teammate</option>
                  <option value="Partner">Spouse / Partner</option>
                </select>
              </div>
            </div>

            {/* Actions panel panel */}
            <div className="grid grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => {
                  if (fileUrl) URL.revokeObjectURL(fileUrl);
                  setSelectedFile(null);
                  setFileUrl(null);
                  setShowReviewModal(false);
                  stopAllMediaStreams();
                  setIsPortalRecordingVideo(false);
                  setIsPortalRecordingVoice(false);
                  setIsPortalRecordingPhoto(false);
                }}
                className="h-11 border border-rose-950 bg-rose-950/25 hover:bg-rose-950/50 text-rose-300 font-bold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 font-sans"
              >
                🔄 Redo / Record Over
              </button>
              
              <button
                type="button"
                onClick={() => {
                  if (!wishFrom) {
                    alert("Please enter your signature name first!");
                    return;
                  }
                  setShowReviewModal(false);
                  handleWishSubmit(new Event('submit') as any);
                }}
                className="h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-lg transition cursor-pointer flex items-center justify-center gap-2 font-sans"
              >
                🚀 Confirm & Send Wish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contributor Final Submission Confirmation Dialog */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-[12000] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-6 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200 text-left">
            <div className="absolute top-[-20px] right-[-20px] text-6xl opacity-5 pointer-events-none select-none">⚠️</div>
            
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-xl shrink-0">
                🔔
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Confirm Your Greeting</h3>
                <p className="text-[10px] text-slate-400">Ready to lock in your surprise wish?</p>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-850 space-y-3">
              <p className="text-xs text-slate-350 leading-relaxed">
                You are about to submit your final <b className="text-white uppercase">{cpType}</b> wish from <span className="text-indigo-300 font-bold">{wishFrom}</span>.
              </p>
              <p className="text-[11px] text-slate-400 leading-normal">
                ⚠️ Once submitted, you cannot change, edit, or retract your message, as it will be safely delivered into <b>{celebrantName}</b>'s central secret surprise album.
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleConfirmFinalSubmit}
                disabled={submitting}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl shadow-lg cursor-pointer transition active:scale-95 flex items-center justify-center gap-2"
              >
                {submitting ? '⏳ Submitting…' : '🚀 Yes, Submit My Wish Now!'}
              </button>
              
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="w-full h-10 bg-slate-950 hover:bg-slate-850 text-slate-400 hover:text-white font-bold text-xs rounded-xl transition border border-slate-800 cursor-pointer"
              >
                Cancel & Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
