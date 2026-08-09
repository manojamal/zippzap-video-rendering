import React, { useState, useRef } from 'react';
import { MediaItem } from '../types';
import { fmtT, getMediaDur, capVidThumb, compressVideoFile, CompressionResult, validateUploadFileSize, validateFileSignature } from '../utils';

interface UploadFormProps {
  onSaveMedia: (media: Omit<MediaItem, 'id' | 'created'>) => void;
  onSaveTextMedia: (data: { text: string; from: string; style: string }) => void;
  onPhotosUploaded: (files: FileList) => void;
  recentMedia: MediaItem[];
  user: any;
  onNavigate: (page: string) => void;
}

export default function UploadForm({
  onSaveMedia,
  onSaveTextMedia,
  onPhotosUploaded,
  recentMedia,
  user,
  onNavigate
}: UploadFormProps) {
  const [upType, setUpType] = useState<'video' | 'audio' | 'text' | 'photo'>('audio');
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileDur, setFileUrlDur] = useState(0);
  const [fileThumb, setFileThumb] = useState<string | null>(null);

  // Compression states
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [compressEta, setCompressEta] = useState(0);
  const [compressStatus, setCompressStatus] = useState('');
  const [compressPreset, setCompressPreset] = useState<'low' | 'medium' | 'high'>('medium');
  const [compressedStats, setCompressedStats] = useState<{
    oldSize: number;
    newSize: number;
    savedPercentage: number;
    originalResolution: string;
    compressedResolution: string;
    originalName: string;
    compressedName: string;
  } | null>(null);

  // Form details
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [note, setNote] = useState('');
  const [eventFor, setEventFor] = useState('');

  // Text form
  const [textBody, setTextBody] = useState('');
  const [textFrom, setTextFrom] = useState('');
  const [textStyle, setTextStyle] = useState('normal');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setFile(null);
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(null);
    setFileUrlDur(0);
    setFileThumb(null);
    setTitle('');
    setFrom('');
    setNote('');
    setCompressedStats(null);
    setIsCompressing(false);
    setCompressProgress(0);
  };

  const handleCompress = async () => {
    if (!file) return;
    setIsCompressing(true);
    setCompressProgress(0);
    setCompressStatus('Initializing optimizer...');
    
    try {
      const result = await compressVideoFile(file, compressPreset, (prog, eta, status) => {
        setCompressProgress(prog);
        setCompressEta(eta);
        setCompressStatus(status);
      });
      
      setCompressedStats({
        oldSize: result.oldSize,
        newSize: result.newSize,
        savedPercentage: result.savedPercentage,
        originalResolution: result.originalResolution,
        compressedResolution: result.compressedResolution,
        originalName: file.name,
        compressedName: result.compressedFile.name
      });
      
      setFile(result.compressedFile);
      const newUrl = URL.createObjectURL(result.compressedFile);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      setFileUrl(newUrl);
    } catch (err) {
      console.error('Compression failed:', err);
    } finally {
      setIsCompressing(false);
    }
  };


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const sizeCheck = validateUploadFileSize(selected);
    if (!sizeCheck.ok) {
      alert(`⚠️ ${sizeCheck.reason}`);
      e.target.value = '';
      return;
    }
    const sigCheck = await validateFileSignature(selected, upType === 'photo' ? 'photo' : upType === 'audio' ? 'audio' : 'video');
    if (!sigCheck.ok) {
      alert(`⚠️ ${sigCheck.reason}`);
      e.target.value = '';
      return;
    }

    setFile(selected);
    const url = URL.createObjectURL(selected);
    setFileUrl(url);
    const dur = await getMediaDur(url, upType);
    setFileUrlDur(dur);
    if (upType === 'video') {
      const thumb = await capVidThumb(url);
      setFileThumb(thumb);
    }
    setTitle(selected.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
  };

  const handleSaveUpload = () => {
    if (!title || !file || !fileUrl) return;
    const mbSize = (file.size / 1024 / 1024).toFixed(1) + ' MB';
    onSaveMedia({
      type: upType,
      name: title,
      from: from || 'Unknown Contributor',
      note: note,
      event: eventFor,
      size: mbSize,
      dur: fileDur,
      url: fileUrl,
      thumb: fileThumb,
      file: file
    });
    resetForm();
  };

  const handleSaveTextAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textBody || !textFrom) return;
    onSaveTextMedia({
      text: textBody,
      from: textFrom,
      style: textStyle
    });
    setTextBody('');
    setTextFrom('');
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onPhotosUploaded(files);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900">📤 Add Celebration Message</h1>
          <p className="text-xs text-slate-500">Submit video diaries, audiorecordings, beautiful messages, or nostalgic photos</p>
        </div>
        <button
          onClick={() => onNavigate('library')}
          className="px-4 py-2 border border-slate-200 hover:border-indigo-600 hover:text-indigo-600 bg-white font-extrabold text-slate-700 text-xs rounded-xl transition cursor-pointer"
        >
          View Library ➔
        </button>
      </div>

      {/* Buttons select grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['audio', 'video', 'text', 'photo'] as const).map(type => {
          const isActive = upType === type;
          const info =
            type === 'audio'
              ? { emoji: '🎙️', title: 'Voice Note', desc: 'MP3, M4A, WAV · up to 50MB' }
              : type === 'video'
              ? { emoji: '🎬', title: 'Video Message', desc: 'MP4, WebM, MOV · up to 500MB' }
              : type === 'text'
              ? { emoji: '✍️', title: 'Text Message', desc: 'Written surprise wish' }
              : { emoji: '📸', title: 'Photos', desc: 'PNG, JPG, WEBP · multiple items' };

          return (
            <div
              key={type}
              onClick={() => {
                setUpType(type);
                resetForm();
              }}
              className={`p-4 border rounded-2xl cursor-pointer hover:border-indigo-400 hover:bg-slate-50/50 transition duration-150 select-none ${
                isActive ? 'border-indigo-500 bg-indigo-50/20 ring-4 ring-indigo-50/50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-2xl mb-1">{info.emoji}</div>
              <div className="text-xs font-bold text-slate-900">{info.title}</div>
              <div className="text-[10px] text-slate-400 mt-2">{info.desc}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* File Upload Zone */}
          {upType !== 'text' && upType !== 'photo' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              {!fileUrl ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/10 rounded-2xl py-12 px-6 text-center cursor-pointer transition select-none relative"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept={upType === 'video' ? 'video/*' : 'audio/*'}
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="text-4xl mb-3">{upType === 'video' ? '🎬' : '🎙️'}</div>
                  <p className="text-xs font-bold text-slate-800">
                    Click to browse your {upType} file
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">MP4, WebM, WAV, MP3, M4A</p>
                </div>
              ) : (
                <div className="bg-slate-950 rounded-2xl p-4 overflow-hidden relative">
                  {upType === 'video' ? (
                    <>
                      <video src={fileUrl} controls className="w-full aspect-video rounded-xl bg-black" />
                      
                      {/* Client-side Video Compressor Component */}
                      <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-3 text-left">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1">
                              <span>⚡</span> Client-Side Video Compressor & Optimizer
                            </h4>
                            <p className="text-[10px] text-slate-400">Reduce video size in-browser to speed up stitching & timeline loading</p>
                          </div>
                          {compressedStats && (
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-black uppercase">
                              OPTIMIZED
                            </span>
                          )}
                        </div>

                        {isCompressing ? (
                          <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 space-y-2">
                            <div className="flex justify-between text-[10px] font-black text-indigo-400 uppercase tracking-wider">
                              <span>{compressStatus}</span>
                              <span>{compressProgress}%</span>
                            </div>
                            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-indigo-500 h-full rounded-full transition-all duration-150"
                                style={{ width: `${compressProgress}%` }}
                              />
                            </div>
                            <div className="text-[9px] text-slate-500 font-medium">
                              Estimated remaining: <strong className="text-white font-bold">{compressEta}s</strong>
                            </div>
                          </div>
                        ) : compressedStats ? (
                          <div className="bg-emerald-950/40 border border-emerald-900/40 rounded-xl p-3.5 space-y-2.5">
                            <div className="flex items-center gap-2 text-[10px] font-black text-emerald-400 uppercase">
                              <span>🎉</span> Optimization Complete!
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-[10px] text-slate-300 font-medium">
                              <div className="bg-slate-900/45 p-2 rounded-lg border border-slate-800/30">
                                <span className="block text-slate-500 text-[9px] uppercase font-bold tracking-wider">Original File</span>
                                <strong className="text-white font-extrabold">{(compressedStats.oldSize / 1024 / 1024).toFixed(1)} MB</strong> · {compressedStats.originalResolution}
                              </div>
                              <div className="bg-indigo-950/20 p-2 rounded-lg border border-indigo-900/20">
                                <span className="block text-indigo-450 text-[9px] uppercase font-bold tracking-wider">Optimized File</span>
                                <strong className="text-white font-extrabold">{(compressedStats.newSize / 1024 / 1024).toFixed(1)} MB</strong> · {compressedStats.compressedResolution}
                              </div>
                            </div>
                            <div className="text-[10px] text-emerald-400 font-extrabold flex items-center gap-1">
                              <span>💡</span> Saved <strong className="text-white text-xs bg-emerald-600 px-2 py-0.5 rounded-full font-black">{compressedStats.savedPercentage}%</strong> storage space!
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCompressedStats(null);
                                resetForm();
                              }}
                              className="text-[9px] text-slate-400 hover:text-white underline cursor-pointer font-bold block"
                            >
                              Reset & load another video file
                            </button>
                          </div>
                        ) : (
                          <div className="bg-slate-900/55 rounded-xl p-3 border border-slate-850 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div className="space-y-1">
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Choose Quality Preset:</span>
                              <div className="flex gap-1.5">
                                {[
                                  { id: 'low', label: 'Fast (480p SD)', desc: '80% smaller' },
                                  { id: 'medium', label: 'Balanced (720p)', desc: '55% smaller' },
                                  { id: 'high', label: 'HD (1080p)', desc: '30% smaller' }
                                ].map((preset) => (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => setCompressPreset(preset.id as any)}
                                    className={`px-2 py-1 rounded-md text-[9px] font-black transition cursor-pointer ${
                                      compressPreset === preset.id
                                        ? 'bg-indigo-600 text-white font-extrabold'
                                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                    }`}
                                    title={preset.desc}
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleCompress}
                              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black rounded-lg cursor-pointer transition shadow active:scale-95 whitespace-nowrap shrink-0"
                            >
                              ⚡ Optimize Video
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="py-6 px-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center">
                      <audio src={fileUrl} controls className="w-full max-w-sm" />
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-4">
                    <div>
                      <div className="text-xs font-bold text-white max-w-[200px] truncate">{file?.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {(file!.size / 1024 / 1024).toFixed(1)} MB · {fmtT(fileDur)}
                      </div>
                    </div>
                    <button
                      onClick={resetForm}
                      className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-900 text-[10px] font-bold rounded-lg cursor-pointer"
                    >
                      Clear File
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Text Message letter inputs */}
          {upType === 'text' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <span>✍️</span> Write your Heartfelt Wish
              </h2>
              <form onSubmit={handleSaveTextAction} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Your Message *</label>
                  <textarea
                    required
                    rows={6}
                    placeholder="E.g. Happy 30th birthday Oluwaseun! This message is from all of us — your friends and family who love you so dearly… 🎂 May this new decade bring you everything your heart desires!"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100 outline-none transition"
                    value={textBody}
                    onChange={e => setTextBody(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">From Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Babatunde Adewale"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100"
                      value={textFrom}
                      onChange={e => setTextFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Mood Style</label>
                    <select
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none"
                      value={textStyle}
                      onChange={e => setTextStyle(e.target.value)}
                    >
                      <option value="normal">Normal</option>
                      <option value="heartfelt">💖 Heartfelt</option>
                      <option value="funny">😂 Funny</option>
                      <option value="prayer">🙏 Prayer</option>
                      <option value="poetry">🎵 Poem</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition mt-2 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-100"
                >
                  💾 Save Message to Library
                </button>
              </form>
            </div>
          )}

          {/* Photo Dropzone Form */}
          {upType === 'photo' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-1.5">
                <span>📸</span> Upload slides
              </h2>
              <div
                onClick={() => photoInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/10 rounded-2xl py-12 px-6 text-center cursor-pointer transition select-none relative"
              >
                <input
                  type="file"
                  multiple
                  ref={photoInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
                <div className="text-4xl mb-3">📸</div>
                <p className="text-xs font-bold text-slate-800">
                  Select background photos
                </p>
                <p className="text-[10px] text-slate-400 mt-1">PNG, JPG, WEBP · Unlimited items at once</p>
              </div>
            </div>
          )}

          {/* Metadata upload form details */}
          {fileUrl && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3">
                Media Details metadata
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Title / Caption *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Birthday wish from Emeka"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Contributor *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Emeka Obi"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600"
                    value={from}
                    onChange={e => setFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">For Celebration event</label>
                  <select
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none"
                    value={eventFor}
                    onChange={e => setEventFor(e.target.value)}
                  >
                    <option value="">— General library —</option>
                    <option value="Oluwaseun's 30th Birthday">Oluwaseun's 30th Birthday</option>
                    <option value="Mama Nkechi's Anniversary">Mama Nkechi's Anniversary</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Private note</label>
                  <textarea
                    rows={2}
                    placeholder="Any private comment to the manager..."
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-600"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSaveUpload}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-lg shadow-indigo-100 flex-1"
                >
                  💾 Save to Media Library
                </button>
                <button
                  onClick={resetForm}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-50 cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar help & limits details */}
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-indigo-50 to-slate-50 border border-indigo-100 rounded-2xl p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-widest">📊 Monthly Limits Allowance</h3>
            <div className="space-y-3 text-xs text-slate-700">
              <div className="flex justify-between items-center text-[10px] text-slate-500">
                <span>ALLOWANCE TIER</span>
                <span className="font-bold text-indigo-600 uppercase tracking-wider">{user?.tier || 'Gold'}</span>
              </div>
              
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span>🎬 Video Uploads</span>
                  <span className="font-bold">Unlimited</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1">
                  <div className="h-full bg-indigo-600 rounded-full" style={{ width: '4%' }}></div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span>💬 Message Allowance</span>
                  <span className="font-bold">Unlimited</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1">
                  <div className="h-full bg-emerald-600 rounded-full" style={{ width: '2%' }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick tips list */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 shadow-sm text-emerald-800">
            <h3 className="text-xs font-bold uppercase tracking-widest mb-3">📌 Upload Guidelines</h3>
            <ul className="space-y-2.5 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-emerald-500 font-bold">✓</span>
                <span>Keep videos under 2 minutes for compile speeds.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-500 font-bold">✓</span>
                <span>Record in landscape (16:9 widescreen) aspect ratio.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-500 font-bold">✓</span>
                <span>Ensure clear light on face and low echo background noise.</span>
              </li>
            </ul>
          </div>

          {/* Recently Added Media lists */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3">
              Recently Uploaded
            </h3>
            <div className="space-y-3">
              {recentMedia.slice(0, 4).map((item, idx) => (
                <div key={`${item.id}_${idx}`} className="flex items-center gap-2 border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {item.thumb ? (
                      <img src={item.thumb} alt={item.name} className="w-full h-full object-cover" />
                    ) : item.type === 'audio' ? (
                      <span>🎙️</span>
                    ) : item.type === 'text' ? (
                      <span>✍️</span>
                    ) : (
                      <span>📸</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{item.name}</div>
                    <div className="text-[10px] text-slate-400 capitalize">{item.type} · {item.size}</div>
                  </div>
                </div>
              ))}
              {recentMedia.length === 0 && (
                <div className="text-center py-6 text-xs text-slate-400">
                  No files added in this session.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
