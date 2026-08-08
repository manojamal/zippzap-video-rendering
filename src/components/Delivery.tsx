import React from 'react';
import { CelebrativeEvent } from '../types';
import { fmtD, daysTo, PIPELINE_STAGES } from '../utils';

function AutoPostToggles({ eventId }: { eventId: string }) {
  const platforms = [
    { name: 'Instagram', icon: '📸' },
    { name: 'TikTok', icon: '🎵' },
    { name: 'YouTube Shorts', icon: '🎥' },
    { name: 'X / Twitter', icon: '🐦' }
  ];
  
  const [selected, setSelected] = React.useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(`zz_autopost_${eventId}`);
    return saved ? JSON.parse(saved) : { Instagram: true, TikTok: false, 'YouTube Shorts': false, 'X / Twitter': true };
  });

  const toggle = (platName: string) => {
    const next = { ...selected, [platName]: !selected[platName] };
    setSelected(next);
    localStorage.setItem(`zz_autopost_${eventId}`, JSON.stringify(next));
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-black text-indigo-650 text-indigo-600 uppercase tracking-widest font-mono">
          🤖 Auto-Post & Syndicate Service
        </span>
        <span className="text-[9px] bg-indigo-50 text-indigo-650 text-indigo-600 border border-indigo-100 font-extrabold px-2.5 py-0.5 rounded-full uppercase">
          Service Active
        </span>
      </div>
      <p className="text-[10px] text-slate-500 leading-normal">
        Toggle target syndications. At 12:00 midnight threshold release, Zipp Zap programmatically renders isomorphically and posts the final MP4 album to the verified platforms below.
      </p>
      <div className="flex flex-wrap gap-2 pt-1 font-sans">
        {platforms.map(plat => {
          const isActive = !!selected[plat.name];
          return (
            <button
              key={plat.name}
              onClick={() => toggle(plat.name)}
              className={`px-3 py-1.5 rounded-xl border text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                isActive
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span>{plat.icon}</span>
              <span>{plat.name}</span>
              <span className="font-mono text-[9px] opacity-75">{isActive ? 'ON' : 'OFF'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface DeliveryProps {
  events: CelebrativeEvent[];
  onMarkDelivered: (id: string) => void;
  onOpenPortal: (id: string) => void;
}

export default function Delivery({ events, onMarkDelivered, onOpenPortal }: DeliveryProps) {
  const activeEvents = events.filter(e => e.status === 'active');

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    alert('🔗 Link copied to clipboard!');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-black text-slate-900 border-b border-slate-100 pb-2">🚀 Send & Deliver Surprises</h1>
        <p className="text-xs text-slate-500 mt-1">Copy contributor upload links, invite your teammate networks, and trigger surprise playbacks!</p>
      </div>

      <div className="space-y-4">
        {activeEvents.map(e => {
          const daysLeft = daysTo(e.date);
          const uploadLink = `https://zippzap.ng/upload/${e.link}`;
          const celebrateLink = `https://zippzap.ng/s/${e.link}`;

          return (
            <div key={e.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-3xl shrink-0">{e.emoji}</div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">{e.title}</h3>
                    <p className="text-xs text-slate-400 capitalize">{e.cel} · {fmtD(e.date)}</p>
                  </div>
                </div>
                <div className="text-left sm:text-right bg-slate-50 px-3.5 py-1.5 border border-slate-100 rounded-xl shrink-0">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-widest">Pipeline countdown</span>
                  <span className="text-sm font-black text-indigo-600">{Math.max(0, daysLeft)} days left</span>
                </div>
              </div>

              {/* Steps indicators */}
              <div className="flex items-center gap-1">
                {PIPELINE_STAGES.map((s, idx) => (
                  <div
                    key={s.id}
                    title={s.label}
                    className={`flex-1 h-1.5 rounded-full ${
                      idx <= e.pipeline ? 'bg-indigo-600' : 'bg-slate-150 bg-slate-100'
                    }`}
                  ></div>
                ))}
              </div>

              {/* Copy Links sections box */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-amber-50/50 border border-amber-250 border-amber-100 rounded-xl p-4 space-y-2">
                  <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">📨 Contributors Upload Link</p>
                  <div className="bg-white border border-slate-200/60 rounded-lg p-2.5 flex justify-between items-center text-xs truncate gap-2">
                    <span className="truncate text-amber-700 font-mono font-medium">{uploadLink}</span>
                    <button
                      onClick={() => copyToClipboard(uploadLink)}
                      className="px-2.5 py-1 bg-amber-600 text-white rounded text-[10px] font-black inline-block shrink-0 cursor-pointer"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 space-y-2">
                  <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">🎁 FINAL CELEBRATION PLAY Link</p>
                  <div className="bg-white border border-slate-250/60 rounded-lg p-2.5 flex justify-between items-center text-xs truncate gap-2">
                    <span className="truncate text-indigo-700 font-mono font-medium">{celebrateLink}</span>
                    <button
                      onClick={() => copyToClipboard(celebrateLink)}
                      className="px-2.5 py-1 bg-indigo-650 bg-indigo-600 text-white rounded text-[10px] font-black inline-block shrink-0 cursor-pointer"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              {/* Simulated Auto-Post Configuration */}
              <AutoPostToggles eventId={e.id} />

              {/* Delivery actions triggers */}
              <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-50 last:border-b-0">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hi, please contribute a surprise wish: ${uploadLink}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-xs font-bold rounded-xl transition decoration-neutral-100"
                >
                  📱 Share via WhatsApp
                </a>
                <button
                  onClick={() => onOpenPortal(e.id)}
                  className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  👁️ Preview contributor portal
                </button>
                <div className="flex-1"></div>
                <button
                  onClick={() => onMarkDelivered(e.id)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow cursor-pointer transition flex items-center gap-1.5"
                >
                  🚀 Fire Surprise Delivery!
                </button>
              </div>
            </div>
          );
        })}

        {activeEvents.length === 0 && (
          <div className="text-center py-20 bg-slate-50 border border-slate-150 rounded-2xl select-none">
            <span className="text-4xl block filter grayscale mb-3">🚀</span>
            <p className="text-sm font-bold text-slate-800">No active celebration surprises campaign</p>
            <p className="text-xs text-slate-400 mt-1">Plan a surprise for someone on the Celebrations calendar first!</p>
          </div>
        )}
      </div>
    </div>
  );
}
