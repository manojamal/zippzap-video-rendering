import React, { useState, useEffect } from 'react';
import * as piperTts from '@mintplex-labs/piper-tts-web';
import { MediaItem } from '../types';
import { fmtT } from '../utils';

interface TextToSpeechProps {
  onSaveVoiceClip: (text: string, duration: number, audioBlob: Blob, fileUrl: string) => void;
  media: MediaItem[];
}

const VOICE_OPTIONS: { id: piperTts.VoiceId; label: string }[] = [
  { id: 'en_US-hfc_female-medium', label: 'Female (US)' },
  { id: 'en_US-hfc_male-medium', label: 'Male (US)' },
  { id: 'en_US-amy-medium', label: 'Female, Warm (US)' },
  { id: 'en_US-ryan-medium', label: 'Male, Friendly (US)' },
  { id: 'en_GB-alba-medium', label: 'Female (UK)' },
  { id: 'en_GB-alan-medium', label: 'Male (UK)' },
];

export default function TextToSpeech({ onSaveVoiceClip, media }: TextToSpeechProps) {
  const [text, setText] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [speaking, setRecording] = useState(false);
  const [status, setStatus] = useState('');
  const [voiceId, setVoiceId] = useState<piperTts.VoiceId>('en_US-hfc_female-medium');
  const [modelProgress, setModelProgress] = useState<number | null>(null);

  const speakPreview = () => {
    if (!text) return;
    if (!window.speechSynthesis) {
      setStatus('Speech synthesis not supported in this browser');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = pitch;

    utterance.onstart = () => {
      setRecording(true);
      setStatus('🔊 Speaking preview...');
    };

    utterance.onend = () => {
      setRecording(false);
      setStatus('Done speaking!');
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopPreview = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setRecording(false);
      setStatus('');
    }
  };

  // Real, fully local neural text-to-speech (Piper, running as WASM/ONNX in the browser -
  // no server, no API key). The first generation for a given voice downloads that voice's
  // model (~15-60MB depending on voice) and caches it in the browser's Origin Private File
  // System; subsequent generations with the same voice are near-instant and fully offline.
  const handleRecordTTS = async () => {
    if (!text) return;
    setStatus('');
    setModelProgress(null);
    setRecording(true);
    try {
      const wav = await piperTts.predict({ text, voiceId }, (progress) => {
        if (progress.total > 0) {
          setModelProgress(Math.round((progress.loaded * 100) / progress.total));
          setStatus(`⬇️ Downloading voice model (one-time, cached after this)...`);
        }
      });
      setModelProgress(null);
      setStatus('🛠️ Synthesizing speech...');

      // Read the real duration back out of the generated audio rather than estimating it.
      const arrayBuf = await wav.arrayBuffer();
      let duration = Math.ceil(text.split(/\s+/).length / 2.5) || 3;
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        duration = decoded.duration;
        await audioCtx.close();
      } catch {
        // fall back to the word-count estimate above if decoding fails for some reason
      }

      const url = URL.createObjectURL(wav);
      onSaveVoiceClip(text, duration, wav, url);
      setText('');
      setStatus('✅ Real neural voice clip generated and saved to library!');
    } catch (err: any) {
      console.error('Piper TTS generation failed:', err);
      setStatus(`❌ Could not generate speech: ${err?.message || err}`);
    } finally {
      setRecording(false);
      setModelProgress(null);
    }
  };

  const templates = [
    { label: '🎂 Birthday', desc: 'Heartfelt birthday greetings', text: "Happy birthday! Today is outline for you and how amazing you are! May this year bring you more success, more laughter, and more beautiful moments than ever before. We love you!" },
    { label: '💍 Anniversary', desc: 'Congratulate couples', text: "Congratulations on this beautiful milestone! Your love story continues to inspire everyone around you. Here's to many more years of love, laughter, and togetherness!" },
    { label: '🎓 Graduation', desc: 'Acknowledge study accomplishment', text: "Congratulations graduate! You did it! Years of hard work and dedication have brought you to this incredible moment. The world is ready for everything you are about to achieve!" },
    { label: '🙏 Prayer', desc: 'Send spiritual blessings', text: "Heavenly Father, on this special day we lift up your beloved child and commit them into your mighty hands. May every dream they carry come to pass. Amen. Happy celebration!" }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-black text-slate-900 border-b border-slate-100 pb-2">🔊 Text to Speech Synthesizer</h1>
        <p className="text-xs text-slate-500 mt-1">Convert text contributions directly into vocal surprise voice notes using live synthesis</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <form className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Draft Message Typography *</label>
              <textarea
                rows={5}
                required
                placeholder="Type your greeting message here..."
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none"
                value={text}
                onChange={e => setText(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  <span>Speed rate</span>
                  <span className="text-indigo-600 lowercase font-mono">{rate.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  value={rate}
                  onChange={e => setRate(parseFloat(e.target.value))}
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  <span>Pitch level</span>
                  <span className="text-indigo-600 lowercase font-mono">{pitch.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  value={pitch}
                  onChange={e => setPitch(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Neural Voice</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none"
                value={voiceId}
                onChange={e => setVoiceId(e.target.value as piperTts.VoiceId)}
              >
                {VOICE_OPTIONS.map(v => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 flex-wrap pt-2">
              <button
                type="button"
                onClick={speakPreview}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-100"
              >
                <span>▶</span> Quick Browser Preview
              </button>
              <button
                type="button"
                onClick={stopPreview}
                className="px-4 py-2 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-50 cursor-pointer"
              >
                <span>⏹</span> Stop Speech
              </button>
              <button
                type="button"
                onClick={handleRecordTTS}
                disabled={speaking}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-100"
              >
                <span>🧠</span> {speaking ? 'Generating...' : 'Generate Real Voice File'}
              </button>
            </div>

            {modelProgress !== null && (
              <div className="space-y-1">
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 transition-all" style={{ width: `${modelProgress}%` }} />
                </div>
                <p className="text-[10px] text-slate-400">{modelProgress}% — one-time voice model download, cached afterward</p>
              </div>
            )}

            {status && (
              <div className="text-[11px] font-semibold text-indigo-600 bg-indigo-50/50 border border-indigo-100 px-3.5 py-1.5 rounded-lg animate-fade-in font-mono">
                {status}
              </div>
            )}
            <p className="text-[10px] text-slate-400 leading-relaxed">
              "Generate Real Voice File" runs a real neural text-to-speech model (Piper) entirely on your device — no server, no API key, no browser restrictions. The chosen voice's model downloads once (typically 15-60MB) and is cached for instant reuse. "Quick Browser Preview" uses your browser's built-in speech voice for a faster, lower-quality listen without saving a file.
            </p>
          </form>
        </div>

        {/* Templates Sidebar */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3">Presaved speech templates</h3>
            <div className="space-y-2">
              {templates.map(val => (
                <div
                  key={val.label}
                  onClick={() => setText(val.text)}
                  className="p-3 bg-slate-50 hover:bg-indigo-50/30 border border-slate-100 hover:border-indigo-100 rounded-xl cursor-pointer transition select-none flex justify-between items-center"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-800">{val.label}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[170px] mt-0.5">{val.desc}</div>
                  </div>
                  <span className="text-[10px] text-indigo-600 font-extrabold uppercase">Apply</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
