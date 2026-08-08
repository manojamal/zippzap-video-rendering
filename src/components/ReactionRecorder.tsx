import React, { useState, useRef, useEffect } from 'react';
import { MediaItem } from '../types';
import { fmtT } from '../utils';

interface ReactionRecorderProps {
  onSaveReactionToLib: (blob: Blob, url: string, dur: number, thumb: string | null) => void;
  celebrantName: string;
}

export default function ReactionRecorder({
  onSaveReactionToLib,
  celebrantName
}: ReactionRecorderProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const recordVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const startCamera = async () => {
    try {
      setResultUrl(null);
      setResultBlob(null);
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err: any) {
      // Be honest about the failure instead of pretending a camera is active -
      // there is nothing real to record without permission/hardware.
      console.warn('Camera access denied or unavailable', err);
      const name = err?.name || '';
      let message = 'Could not access your camera/microphone.';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        message = 'Camera/microphone access was denied. Please allow access in your browser settings and try again.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        message = 'No camera or microphone was found on this device.';
      } else if (name === 'NotReadableError') {
        message = 'Your camera is already in use by another application.';
      }
      setCameraError(message);
      setCameraActive(false);
    }
  };

  const startRecording = () => {
    setCountdown(3);
    let count = 3;
    const interval = window.setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(interval);
        setCountdown(null);
        triggerActualRecord();
      }
    }, 1000);
  };

  const triggerActualRecord = () => {
    setRecordedChunks([]);
    setRecording(true);
    setDuration(0);

    // Increment duration timer
    timerRef.current = window.setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);

    if (streamRef.current) {
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const recorder = new MediaRecorder(streamRef.current, { mimeType: mime });
      recorderRef.current = recorder;
      
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => {
        if (e.data?.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const finalBlob = new Blob(chunks, { type: recorder.mimeType || mime });
        const finalUrl = URL.createObjectURL(finalBlob);
        setResultBlob(finalBlob);
        setResultUrl(finalUrl);
      };

      recorder.start(100);
    } else {
      // No live stream is available (camera never started successfully) - nothing to record.
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      setCameraError('Recording could not start because no camera stream is active.');
    }
  };

  const stopRecording = () => {
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const handleSave = () => {
    if (!resultBlob || !resultUrl) return;
    onSaveReactionToLib(resultBlob, resultUrl, duration || 5, null);
    
    // Stop tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setCameraActive(false);
    setResultUrl(null);
    setResultBlob(null);
  };

  const retake = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultBlob(null);
    setDuration(0);
    startCamera();
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-5">
      <div>
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
          <span>🎬</span> Webcam Reaction Recorder
        </h2>
        <p className="text-xs text-slate-500 mt-1">Capture {celebrantName}'s surprise live on camera to place on your timeline</p>
      </div>

      <div className="bg-slate-950 rounded-2xl overflow-hidden aspect-video flex items-center justify-center relative shadow-inner">
        {/* Blinking Recording visual badge */}
        {recording && (
          <div className="absolute top-4 left-4 bg-rose-600 text-white font-extrabold text-[10px] px-2.5 py-1 rounded-full flex items-center gap-2 animate-bounce z-10">
            <span className="w-1.5 h-1.5 bg-white rounded-full"></span> LIVE RECORDING · {fmtT(duration)}
          </div>
        )}

        {/* Countdown overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-20 flex items-center justify-center">
            <span className="text-6xl font-black text-white animate-ping">{countdown}</span>
          </div>
        )}

        {cameraActive && !resultUrl ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover transform -scale-x-100"
          />
        ) : resultUrl ? (
          <video
            ref={recordVideoRef}
            src={resultUrl}
            controls
            autoPlay
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <div className="text-center space-y-4 px-6">
            <div className="text-4xl">📸</div>
            {cameraError && (
              <p className="text-rose-400 text-xs font-semibold leading-relaxed">{cameraError}</p>
            )}
            <button
              onClick={startCamera}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
            >
              {cameraError ? 'Try Again' : 'Enable Webcam Stream'}
            </button>
          </div>
        )}
      </div>

      {cameraActive && (
        <div className="flex justify-center gap-3">
          {!resultUrl ? (
            !recording ? (
              <button
                onClick={startRecording}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-2 cursor-pointer"
              >
                <span>⏺</span> Record Countdown
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-2 cursor-pointer"
              >
                <span>⏹</span> Stop Recording
              </button>
            )
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
              >
                💾 Save to Media Library
              </button>
              <button
                onClick={retake}
                className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
              >
                🔄 Retake
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
